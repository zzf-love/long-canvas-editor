import assert from 'node:assert/strict';
import {test} from 'node:test';
import {webcrypto} from 'node:crypto';
import {BackgroundUpdateConsumer, BackgroundPersistenceError, pageHash, canonicalJSON, holdAutosaveLock, autosaveStatus} from '../src/backgroundUpdate';
import {hashPage} from '../scripts/background-server.mjs';
import type {Project, DesignElement} from '../src/types';
import type {PageUpdate} from '../src/pageUpdate';

Object.defineProperty(globalThis,'crypto',{value:webcrypto,configurable:true});
const layer=(id:string,tx=0):DesignElement=>({id,name:id,type:'shape',markup:'',bbox:{x:0,y:0,width:100,height:100},tx,ty:0,sx:1,sy:1,locked:false,hidden:false,opacity:.88,linkId:'user-link'});
const fixture=():Project=>({schemaVersion:1,id:'project',title:'Test',width:790,updatedAt:'2026-09-19T00:00:00Z',assets:{},pages:['page-01','page-02','page-03'].map(id=>({id,title:id,width:790,height:1000,sourceWidth:750,defs:'',guides:[],elements:[layer(`${id}/background`),layer(`${id}/editable`)]}))});
const patch:PageUpdate={kind:'long-canvas-page-update',schemaVersion:1,targetProjectId:'project',pageId:'page-03',sourceWidth:750,title:'Only screen3',assets:{},removeElementIds:[],elements:[{...layer('page-03/editable',25),opacity:undefined,linkId:undefined}],preserveLayerOrder:true};
async function setup(){
  let current=fixture(),disk=structuredClone(current),applies=0,failSave=false;
  const receipt=new Set<string>(),history:Project[]=[];
  const host={current:()=>current,hasReceipt:async(id:string)=>receipt.has(id),apply:(next:Project)=>{history.push(current);current=next;applies++},persist:async(project:Project,id:string)=>{if(failSave)throw new Error('Disk full');disk=structuredClone(project);receipt.add(id)}};
  const envelope={id:'update-one',patch,expectedPageHash:await pageHash(current,'page-03')};
  return {host,envelope,consumer:new BackgroundUpdateConsumer(host),get current(){return current},get disk(){return disk},get applies(){return applies},history,receipt,setCurrent:(p:Project)=>{current=p},failSave:(v:boolean)=>{failSave=v}};
}

test('browser and backend calculate the same canonical page hash',async()=>{
  const p=fixture();assert.equal(await pageHash(p,'page-03'),hashPage(p.pages[2]));
  const reversed=Object.fromEntries(Object.entries(p.pages[2]).reverse());
  assert.equal(hashPage(reversed),hashPage(p.pages[2]));
  assert.equal(canonicalJSON({a:1,z:undefined}),canonicalJSON({a:1}));
});
test('only the targeted page changes; original user opacity/link/order and undo remain',async()=>{
  const s=await setup(),before=s.current;
  assert.equal(await s.consumer.consume(s.envelope),'applied');
  assert.equal(s.current.pages[0],before.pages[0]);assert.equal(s.current.pages[1],before.pages[1]);
  assert.equal(s.current.pages[2].elements[0],before.pages[2].elements[0]);
  assert.equal(s.current.pages[2].elements[1].opacity,.88);assert.equal(s.current.pages[2].elements[1].linkId,'user-link');
  assert.equal(s.current.pages[2].height,1000);assert.equal(s.current.pages[2].elements[1].tx,25);
  assert.equal(s.history[0],before);assert.deepEqual(s.disk,s.current);
});
test('lost ACK or reload sees receipt and does not overwrite subsequent hand edits or undo',async()=>{
  const s=await setup();await s.consumer.consume(s.envelope);
  const hand=structuredClone(s.current);hand.pages[2].elements[1].tx=97;s.setCurrent(hand);
  assert.equal(await new BackgroundUpdateConsumer(s.host).consume(s.envelope),'already-applied');
  assert.equal(s.current.pages[2].elements[1].tx,97);assert.equal(s.applies,1);
  s.setCurrent(s.history[0]);
  assert.equal(await new BackgroundUpdateConsumer(s.host).consume(s.envelope),'already-applied');
  assert.equal(s.current.pages[2].elements[1].tx,0);assert.equal(s.applies,1);
});
test('same-page manual edits conflict; other pages can change independently',async()=>{
  const s=await setup();const edited=structuredClone(s.current);edited.pages[2].elements[1].tx=7;s.setCurrent(edited);
  await assert.rejects(s.consumer.consume(s.envelope),/未覆盖手动编辑/);assert.equal(s.applies,0);
  const t=await setup();const other=structuredClone(t.current);other.pages[0].elements[1].tx=12;t.setCurrent(other);
  await t.consumer.consume(t.envelope);assert.equal(t.current.pages[0].elements[1].tx,12);
});
test('edits arriving while awaiting storage or hashing defer the update',async()=>{
  const s=await setup();const host={...s.host,hasReceipt:async()=>{s.setCurrent(structuredClone(s.current));return false}};
  assert.equal(await new BackgroundUpdateConsumer(host).consume(s.envelope),'retry');assert.equal(s.applies,0);
  assert.equal(await new BackgroundUpdateConsumer({...s.host,isEditing:()=>true}).consume(s.envelope),'retry');assert.equal(s.applies,0);
});
test('save failure retries persistence without applying twice',async()=>{
  const s=await setup();s.failSave(true);
  await assert.rejects(s.consumer.consume(s.envelope),BackgroundPersistenceError);assert.equal(s.applies,1);assert.equal(s.receipt.size,0);
  s.failSave(false);assert.equal(await s.consumer.consume(s.envelope),'already-applied');assert.equal(s.applies,1);assert.equal(s.receipt.size,1);
});
test('wrong project and asset conflicts leave the current project intact',async()=>{
  const s=await setup();await assert.rejects(s.consumer.consume({...s.envelope,patch:{...patch,targetProjectId:'other'}}),/不匹配/);assert.equal(s.applies,0);
  const withAsset={...s.current,assets:{shared:{mime:'image/png',data:'AAAA'}}};s.setCurrent(withAsset);
  await assert.rejects(s.consumer.consume({...s.envelope,patch:{...patch,assets:{shared:{mime:'image/png',data:'BBBB'}}}}),/素材.*冲突/);
  assert.equal(s.applies,0);assert.equal(s.current,withAsset);
});

test('a second tab cannot save stale data; takeover requires a new mount after the old owner releases',async()=>{
  let held=false;const states:boolean[][]=[[],[],[]];
  const manager={request:async(_name:string,_options:unknown,callback:(lock:unknown)=>Promise<void>)=>{const acquired=!held;if(acquired)held=true;try{await callback(acquired?{}:null)}finally{if(acquired)held=false}}} as unknown as LockManager;
  const closeA=holdAutosaveLock(manager,v=>states[0].push(v));
  const closeB=holdAutosaveLock(manager,v=>states[1].push(v));
  assert.deepEqual(states[0],[true]);assert.deepEqual(states[1],[false]);
  closeA();await new Promise(resolve=>setTimeout(resolve,0));
  assert.deepEqual(states[1],[false]);
  const closeFresh=holdAutosaveLock(manager,v=>states[2].push(v));assert.deepEqual(states[2],[true]);
  closeB();closeFresh();
});

test('rapid undo and redo restores the saved status without requiring another write',()=>{
  const before=fixture(),after={...before,updatedAt:'2026-09-19T00:01:00Z'};
  let diskStatus={project:after,label:'本机已保存 08:01'};
  assert.equal(autosaveStatus(after,diskStatus),'本机已保存 08:01');
  // Undo followed by redo inside the 700ms debounce returns the identical saved history object.
  assert.equal(autosaveStatus(before,diskStatus),'正在保存…');
  assert.equal(autosaveStatus(after,diskStatus),'本机已保存 08:01');
  // A slower save finishing after the user has redone must not falsely say the newer view is saved.
  diskStatus={project:before,label:'本机已保存 08:02'};
  assert.equal(autosaveStatus(after,diskStatus),'正在保存…');
  diskStatus={project:after,label:'本机已保存 08:03'};
  assert.equal(autosaveStatus(after,diskStatus),'本机已保存 08:03');
});
