import assert from 'node:assert/strict';
import {test} from 'node:test';
import {applyPageUpdate, validatePageUpdateHeight, type PageUpdate} from '../src/pageUpdate';
import {pageOffsets} from '../src/longLayout';
import type {DesignElement, Project} from '../src/types';

const layer = (id: string, background = false): DesignElement => ({
  id, name: id, type: 'shape',
  markup: background ? '<rect width="790" height="1000" fill="#fff"/>' : '<rect x="40" y="60" width="100" height="100" fill="#123456"/>',
  bbox: background ? {x:0,y:0,width:790,height:1000} : {x:40,y:60,width:100,height:100},
  tx:0, ty:0, sx:1, sy:1, locked:background, hidden:false,
  opacity:.88, linkId:background ? undefined : 'hand-linked',
});
const fixture = (): Project => ({
  schemaVersion:1, id:'project', title:'Research', width:790,
  updatedAt:'2026-09-19T00:00:00Z', assets:{},
  pages:['before','research','after'].map(id=>({
    id, title:id, width:790, height:1000, sourceWidth:790, defs:'',
    elements:[layer(`${id}-background`,true),layer(`${id}-chart`)],
    guides:[{id:`${id}-guide`,axis:'y',value:400}],
  })),
});
const revision = (options: Partial<PageUpdate> = {}): PageUpdate => ({
  kind:'long-canvas-page-update', schemaVersion:1, targetProjectId:'project',
  pageId:'research', sourceWidth:790, title:'Research revision',
  preserveLayerOrder:true, removeElementIds:[], elements:[], assets:{}, ...options,
});

test('omitting height retains the current layout, layer order, and guides',()=>{
  const project=fixture(),before=structuredClone(project);
  const result=applyPageUpdate(project,revision());
  assert.deepEqual(result,project);
  assert.equal(result.pages[1].height,1000);
  assert.equal(result.pages[1].guides,project.pages[1].guides);
  assert.deepEqual(project,before);
});

test('height-only revision adapts the background while following sections shift without layer changes',()=>{
  const project=fixture(),before=structuredClone(project);
  const result=applyPageUpdate(project,revision({height:2200}));
  const originalTarget=project.pages[1],target=result.pages[1];
  assert.equal(target.height,2200);
  assert.equal(target.elements[0].bbox.height,2200);
  assert.match(target.elements[0].markup,/height="2200"/);
  assert.equal(target.elements[1],originalTarget.elements[1]);
  assert.equal(target.guides,originalTarget.guides);
  assert.equal(result.pages[0],project.pages[0]);
  assert.equal(result.pages[2],project.pages[2]);
  assert.deepEqual(pageOffsets(project).map(p=>p.top),[0,1000,2000]);
  assert.deepEqual(pageOffsets(result).map(p=>p.top),[0,1000,3200]);
  assert.deepEqual(project,before);
});

test('height and replacement layers apply together without scaling finished replacement artwork twice',()=>{
  const project=fixture();
  const background={...layer('research-background',true),bbox:{x:0,y:0,width:790,height:2400},markup:'<rect width="790" height="2400" fill="#e7edf3"/>',opacity:undefined};
  const chart={...layer('research-chart'),bbox:{x:40,y:300,width:710,height:1200},markup:'<rect x="40" y="300" width="710" height="1200" fill="#123456"/>',opacity:undefined,linkId:undefined};
  const result=applyPageUpdate(project,revision({height:2400,elements:[chart,background]}));
  const target=result.pages[1];
  assert.equal(target.height,2400);
  assert.deepEqual(target.elements.map(e=>e.id),['research-background','research-chart']);
  assert.deepEqual(target.elements[0].bbox,background.bbox);
  assert.equal(target.elements[0].markup,background.markup);
  assert.deepEqual(target.elements[1].bbox,chart.bbox);
  assert.equal(target.elements[1].markup,chart.markup);
  assert.equal(target.elements[1].opacity,.88);
  assert.equal(target.elements[1].linkId,'hand-linked');
  assert.equal(result.pages[0],project.pages[0]);
  assert.equal(result.pages[2],project.pages[2]);
});

test('height accepts exact section boundaries and rejects invalid values without mutating the project',()=>{
  const project=fixture(),before=structuredClone(project);
  assert.equal(validatePageUpdateHeight(undefined),undefined);
  for (const height of [400,6000]) {
    assert.equal(validatePageUpdateHeight(height),height);
    assert.equal(applyPageUpdate(project,revision({height})).pages[1].height,height);
  }
  for (const height of [null,'2200',true,0,399,6001,2200.5,NaN,Infinity,-Infinity]) {
    assert.throws(()=>validatePageUpdateHeight(height),/400–6000px/);
    assert.throws(()=>applyPageUpdate(project,revision({height:height as number})),/400–6000px/);
  }
  assert.deepEqual(project,before);
});
