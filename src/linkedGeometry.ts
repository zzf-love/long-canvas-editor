import type {AlignMode, DesignElement, DesignPage} from './types';
import {alignElements, distributeElements, unionBoxes, visualBox} from './geometry';

/** Linked items act as one alignment unit, preserving the layout inside the link. */
function units(page:DesignPage, ids:readonly string[]) {
 const wanted=new Set(ids), groups=new Map<string,DesignElement[]>();
 for(const el of page.elements){
  if(!wanted.has(el.id)||el.locked||el.hidden)continue;
  const key=el.linkId?`link:${el.linkId}`:`element:${el.id}`;
  groups.set(key,[...(groups.get(key)||[]),el]);
 }
 return [...groups].map(([id,members])=>({members,proxy:{...members[0],id,bbox:unionBoxes(members.map(visualBox)),tx:0,ty:0,sx:1,sy:1} as DesignElement}));
}
export function selectionUnitCount(page:DesignPage,ids:readonly string[]){return units(page,ids).length}
function transformUnits(page:DesignPage,ids:readonly string[],fn:(page:DesignPage,ids:string[])=>DesignPage):DesignPage {
 const groups=units(page,ids), proxies=groups.map(g=>g.proxy);
 const result=fn({...page,elements:proxies},proxies.map(e=>e.id));
 const deltas=new Map<string,{x:number;y:number}>();
 for(const group of groups){const moved=result.elements.find(e=>e.id===group.proxy.id)!;for(const el of group.members)deltas.set(el.id,{x:moved.tx,y:moved.ty})}
 let changed=false;
 const elements=page.elements.map(el=>{const d=deltas.get(el.id);if(!d||(!d.x&&!d.y))return el;changed=true;return {...el,tx:el.tx+d.x,ty:el.ty+d.y}});
 return changed?{...page,elements}:page;
}
export function alignLinkedElements(page:DesignPage,ids:readonly string[],mode:AlignMode,target:'page'|'selection'){
 return transformUnits(page,ids,(proxy,keys)=>alignElements(proxy,keys,mode,target));
}
export function distributeLinkedElements(page:DesignPage,ids:readonly string[],axis:'x'|'y'){
 return transformUnits(page,ids,(proxy,keys)=>distributeElements(proxy,keys,axis));
}
