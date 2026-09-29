import assert from 'node:assert/strict';
import {test} from 'node:test';
import {webcrypto} from 'node:crypto';
import {ManualBackgroundGate} from '../src/manualBackgroundGate';
import {BackgroundUpdateConsumer, BackgroundPersistenceError, pageHash, type BackgroundUpdate} from '../src/backgroundUpdate';
import type {Project, DesignElement} from '../src/types';

Object.defineProperty(globalThis,'crypto',{value:webcrypto,configurable:true});
const element:DesignElement={id:'caption',name:'Caption',type:'text',markup:'original',bbox:{x:44,y:60,width:200,height:30},tx:0,ty:0,sx:1,sy:1,locked:false,hidden:false};
async function fixture(){
  let current:Project={schemaVersion:1,id:'project',title:'Test',width:790,updatedAt:'2026-09-19T00:00:00Z',assets:{},pages:[{id:'page-03',title:'Origins',width:790,height:1180,sourceWidth:750,defs:'',guides:[],elements:[element]}]};
  let applies=0,failSave=false,editing=false;
  const receipts=new Set<string>();
  const consumer=new BackgroundUpdateConsumer({current:()=>current,hasReceipt:async id=>receipts.has(id),isEditing:()=>editing,apply:next=>{current=next;applies++},persist:async(_project,id)=>{if(failSave)throw new Error('Storage unavailable');receipts.add(id)}});
  const envelope:BackgroundUpdate={id:'revision-a',expectedPageHash:await pageHash(current,'page-03'),patch:{kind:'long-canvas-page-update',schemaVersion:1,targetProjectId:'project',pageId:'page-03',sourceWidth:750,title:'第三屏调整',assets:{},removeElementIds:[],elements:[{...element,tx:10}],preserveLayerOrder:true}};
  const gate=new ManualBackgroundGate('project');
  const consume=async(update:BackgroundUpdate)=>await consumer.consume(update)==='retry'?'retry' as const:'finished' as const;
  return {gate,envelope,consume,consumer,receipts,get current(){return current},get applies(){return applies},edit:()=>{current={...current,pages:current.pages.map(p=>({...p,elements:[{...element,tx:88}]}))}},setEditing:(value:boolean)=>{editing=value},failSave:(value:boolean)=>{failSave=value}};
}

test('poll discovery never applies artwork, persists receipts, or implies consent',async()=>{
  const f=await fixture();
  for(let i=0;i<3;i++){f.gate.discover(f.envelope);await f.gate.run(f.consume)}
  assert.equal(f.applies,0);assert.equal(f.receipts.size,0);
  assert.deepEqual(f.gate.state,{pendingUpdate:{id:'revision-a',title:'第三屏调整',pageId:'page-03'},applying:false});
  assert.equal(f.gate.approve('not-discovered'),false);
});

test('one click applies one discovered ID; duplicate click and next queued revision do not apply again',async()=>{
  const f=await fixture();f.gate.discover(f.envelope);
  assert.equal(f.gate.approve('revision-a'),true);assert.equal(f.gate.state.applying,true);
  assert.equal(f.gate.approve('revision-a'),false);
  await Promise.all([f.gate.run(f.consume),f.gate.run(f.consume)]);
  assert.equal(f.applies,1);assert.equal(f.gate.state.pendingUpdate,null);assert.equal(f.gate.state.applying,false);
  const next={...f.envelope,id:'revision-b',expectedPageHash:await pageHash(f.current,'page-03')};
  f.gate.discover(next);await f.gate.run(f.consume);
  assert.equal(f.applies,1);assert.equal(f.gate.state.applying,false);
  assert.equal(f.gate.approve('revision-b'),true);await f.gate.run(f.consume);assert.equal(f.applies,2);
});

test('user input and transient storage failures retain consent for the original ID only',async()=>{
  const f=await fixture();f.gate.discover(f.envelope);f.gate.approve('revision-a');f.setEditing(true);
  await f.gate.run(f.consume);assert.equal(f.applies,0);assert.equal(f.gate.state.applying,true);
  f.setEditing(false);f.failSave(true);
  await assert.rejects(f.gate.run(f.consume),BackgroundPersistenceError);
  assert.equal(f.applies,1);assert.equal(f.gate.state.applying,true);
  f.failSave(false);await f.gate.run(f.consume);
  assert.equal(f.applies,1);assert.equal(f.receipts.size,1);assert.equal(f.gate.state.pendingUpdate,null);
});

test('lost ACK retries the durable receipt without replacing later hand edits',async()=>{
  const f=await fixture();f.gate.discover(f.envelope);f.gate.approve('revision-a');
  await assert.rejects(f.gate.run(async update=>{await f.consumer.consume(update);throw new Error('ACK offline')}),/ACK offline/);
  assert.equal(f.applies,1);f.edit();
  await f.gate.run(f.consume);assert.equal(f.applies,1);assert.equal(f.current.pages[0].elements[0].tx,88);
  // A reload creates a fresh gate: even receipt reconciliation waits for a new click.
  const fresh=new ManualBackgroundGate('project');fresh.discover(f.envelope);await fresh.run(f.consume);
  assert.equal(f.applies,1);assert.equal(fresh.state.applying,false);
});

test('conflict rejection clears consent and leaves hand edits intact',async()=>{
  const f=await fixture();f.gate.discover(f.envelope);f.gate.approve('revision-a');f.edit();
  let rejection='';
  await f.gate.run(async update=>{try{await f.consumer.consume(update);assert.fail('must reject')}catch(error){rejection=(error as Error).message;return 'finished'}});
  assert.match(rejection,/未覆盖手动编辑/);assert.equal(f.applies,0);assert.equal(f.current.pages[0].elements[0].tx,88);
  assert.equal(f.gate.state.pendingUpdate,null);assert.equal(f.gate.state.applying,false);
});

test('replacement queue head and project switch revoke prior consent',async()=>{
  const f=await fixture();f.gate.discover(f.envelope);f.gate.approve('revision-a');
  f.gate.discover({...f.envelope,id:'revision-b'});await f.gate.run(f.consume);assert.equal(f.applies,0);
  f.gate.approve('revision-b');f.gate.setProject('another-project');
  assert.equal(f.gate.state.pendingUpdate,null);assert.equal(f.gate.state.applying,false);
  f.gate.discover(f.envelope);assert.equal(f.gate.state.pendingUpdate,null);
  f.gate.setProject('project');f.gate.discover(f.envelope);await f.gate.run(f.consume);assert.equal(f.applies,0);
});

test('finishing a stale in-flight operation never consumes a newly discovered item',async()=>{
  const f=await fixture();f.gate.discover(f.envelope);f.gate.approve('revision-a');
  let release!:(value:'finished')=>void;
  const running=f.gate.run(()=>new Promise(resolve=>{release=resolve}));
  f.gate.discover({...f.envelope,id:'revision-b'});release('finished');await running;
  assert.equal(f.gate.state.pendingUpdate?.id,'revision-b');assert.equal(f.gate.state.applying,false);
  await f.gate.run(f.consume);assert.equal(f.applies,0);
});
