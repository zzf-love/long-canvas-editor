import {useRef,useState} from 'react';
import type {Project,DesignPage,Box,Guide,SnapLine} from './types';
import Artwork from './Artwork';
import {snapMove,unionBoxes,visualBox} from './geometry';
type Props={project:Project;page:DesignPage;selected:string[];setSelected:(s:string[])=>void;zoom:number;snap:boolean;showGuides:boolean;updatePage:(fn:(p:DesignPage)=>DesignPage,record?:boolean)=>void;begin:()=>void;commit:()=>void;onMeasure:(boxes:Record<string,Box>)=>void;editText:()=>void};
export default function Canvas(p:Props){
 const {page,selected,zoom}=p,board=useRef<HTMLDivElement>(null),[lines,setLines]=useState<SnapLine[]>([]),[marquee,setMarquee]=useState<Box|null>(null);
 const items=page.elements.filter(e=>selected.includes(e.id)&&!e.hidden),movableItems=items.filter(e=>!e.locked),box=movableItems.length?unionBoxes(movableItems.map(visualBox)):null;
 const point=(e:{clientX:number;clientY:number})=>{const r=board.current!.getBoundingClientRect();return{x:(e.clientX-r.left)/zoom,y:(e.clientY-r.top)/zoom}};
 const listen=(move:(e:PointerEvent)=>void,end:(e:PointerEvent)=>void)=>{const done=(e:PointerEvent)=>{window.removeEventListener('pointermove',move);window.removeEventListener('pointerup',done);window.removeEventListener('pointercancel',done);end(e)};window.addEventListener('pointermove',move);window.addEventListener('pointerup',done);window.addEventListener('pointercancel',done)};
 const startMove=(e:React.PointerEvent,ids:string[])=>{
  if(e.button!==0)return;e.preventDefault();const origin=point(e),snapshot=page;
  const movable=ids.filter(id=>{const el=snapshot.elements.find(el=>el.id===id);return el&&!el.locked&&!el.hidden});if(!movable.length)return;
  p.begin();let changed=false;
  listen(ev=>{const pos=point(ev);let dx=pos.x-origin.x,dy=pos.y-origin.y;const lockedAxis=ev.shiftKey?(Math.abs(dx)>Math.abs(dy)?'y':'x'):null;if(lockedAxis==='y')dy=0;else if(lockedAxis==='x')dx=0;
   const result=p.snap&&!ev.altKey?snapMove(snapshot,movable,dx,dy,6/zoom):{dx,dy,lines:[]};if(lockedAxis){if(lockedAxis==='x')result.dx=0;else result.dy=0;result.lines=result.lines.filter(l=>l.axis!==lockedAxis)}setLines(result.lines);changed=true;
   p.updatePage(current=>({...current,elements:current.elements.map(el=>{const base=snapshot.elements.find(x=>x.id===el.id);return base&&movable.includes(el.id)?{...el,tx:base.tx+result.dx,ty:base.ty+result.dy}:el})}),false);
  },()=>{setLines([]);if(changed)p.commit();else p.commit()});
 };
 const pointerDown=(e:React.PointerEvent)=>{
  if(e.button!==0)return;const id=(e.target as Element).closest('[data-element-id]')?.getAttribute('data-element-id');
  if(id){let ids=selected;if(e.shiftKey){ids=selected.includes(id)?selected.filter(x=>x!==id):[...selected,id];p.setSelected(ids);return;}if(!selected.includes(id)){ids=[id];p.setSelected(ids);}startMove(e,ids);return;}
  if((e.target as Element).closest('.handle,.guide-line'))return;
  e.preventDefault();const origin=point(e);if(!e.shiftKey)p.setSelected([]);
  const prev=e.shiftKey?selected:[];let bounds:Box|null=null;
  listen(ev=>{const pt=point(ev);bounds={x:Math.min(origin.x,pt.x),y:Math.min(origin.y,pt.y),width:Math.abs(pt.x-origin.x),height:Math.abs(pt.y-origin.y)};setMarquee(bounds)},()=>{if(bounds&&bounds.width>3&&bounds.height>3){const b=bounds;p.setSelected([...new Set([...prev,...page.elements.filter(el=>{const z=visualBox(el);return !el.hidden&&!el.locked&&z.x>=b.x&&z.y>=b.y&&z.x+z.width<=b.x+b.width&&z.y+z.height<=b.y+b.height}).map(el=>el.id)])]);}setMarquee(null)});
 };
 const guideDrag=(e:React.PointerEvent,axis:'x'|'y',existing?:Guide)=>{
  e.preventDefault();e.stopPropagation();p.begin();const id=existing?.id||crypto.randomUUID();
  if(!existing)p.updatePage(q=>({...q,guides:[...q.guides,{id,axis,value:axis==='x'?point(e).x:point(e).y}]}),false);
  listen(ev=>{const v=point(ev)[axis];p.updatePage(q=>({...q,guides:q.guides.map(g=>g.id===id?{...g,value:Math.round(v)}:g)}),false)},ev=>{const v=point(ev)[axis],max=axis==='x'?page.width:page.height;if(v<0||v>max)p.updatePage(q=>({...q,guides:q.guides.filter(g=>g.id!==id)}),false);p.commit()});
 };
 const resize=(e:React.PointerEvent)=>{e.preventDefault();e.stopPropagation();if(!box)return;const start=point(e),snapshot=page;p.begin();
  listen(ev=>{const pt=point(ev),factor=Math.max(.03,(box.width+(pt.x-start.x))/Math.max(1,box.width));p.updatePage(cur=>({...cur,elements:cur.elements.map(el=>{const base=snapshot.elements.find(z=>z.id===el.id)!;if(!selected.includes(el.id)||el.locked||el.hidden)return el;const b=visualBox(base);return {...base,sx:base.sx*factor,sy:base.sy*factor,tx:box.x+(b.x-box.x)*factor-base.bbox.x,ty:box.y+(b.y-box.y)*factor-base.bbox.y}})}),false)},()=>p.commit());
 };
 const ruler=(axis:'x'|'y')=>{const max=axis==='x'?page.width:page.height;return <svg className={`ruler ruler-${axis}`} width={axis==='x'?max*zoom:24} height={axis==='y'?max*zoom:24} onPointerDown={e=>guideDrag(e,axis==='x'?'y':'x')} aria-label={axis==='x'?'从顶部标尺拖出水平参考线':'从左侧标尺拖出垂直参考线'}>{Array.from({length:Math.floor(max/20)+1},(_,i)=>{const n=i*20,major=n%100===0,pos=n*zoom;return <g key={n}>{axis==='x'?<><line x1={pos} x2={pos} y1={major?14:19} y2={24}/>{major&&<text x={pos+3} y={10}>{n}</text>}</>:<><line x1={major?14:19} x2={24} y1={pos} y2={pos}/>{major&&<text x={3} y={pos+11} transform={`rotate(-90 3 ${pos+11})`}>{n}</text>}</>}</g>})}</svg>};
 return <main className="workspace">
  <div className="canvas-caption"><b>{page.title}</b><span>{page.width} × {page.height} px</span><span>{Math.round(zoom*100)}%</span></div>
  <div className="canvas-scroll"><div className="board-wrap" style={{width:page.width*zoom,height:page.height*zoom}}>
   {ruler('x')}{ruler('y')}
   <div ref={board} className="board" data-testid="canvas" style={{width:page.width*zoom,height:page.height*zoom}} onPointerDown={pointerDown} onDoubleClick={e=>{if((e.target as Element).closest('[data-element-id]'))p.editText()}}>
    <Artwork project={p.project} page={page} interactive onMeasure={p.onMeasure} style={{width:page.width*zoom,height:page.height*zoom}}/>
    {p.showGuides&&page.guides.map(g=><div key={g.id} role="separator" aria-label={`${g.axis==='x'?'垂直':'水平'}参考线 ${g.value}`} className={`guide-line guide-${g.axis}`} style={g.axis==='x'?{left:g.value*zoom}:{top:g.value*zoom}} onPointerDown={e=>guideDrag(e,g.axis,g)} onDoubleClick={e=>{e.stopPropagation();p.updatePage(q=>({...q,guides:q.guides.filter(x=>x.id!==g.id)}))}}><span>{Math.round(g.value)}</span></div>)}
    {lines.map((l,i)=><div key={i} className={`snap-line guide-${l.axis}`} style={l.axis==='x'?{left:l.value*zoom}:{top:l.value*zoom}}/>)}
    {items.map(el=>{const b=visualBox(el);return <div key={el.id} className={`selection ${el.locked?'is-locked':''}`} style={{left:b.x*zoom,top:b.y*zoom,width:b.width*zoom,height:b.height*zoom}}/>})}
    {box&&items.some(e=>!e.locked)&&<div className="selection group-selection" style={{left:box.x*zoom,top:box.y*zoom,width:box.width*zoom,height:box.height*zoom}}><span className="handle tl"/><span className="handle tr"/><span className="handle bl"/><button className="handle br" aria-label="等比缩放选中元素" onPointerDown={resize}/></div>}
    {marquee&&<div className="marquee" style={{left:marquee.x*zoom,top:marquee.y*zoom,width:marquee.width*zoom,height:marquee.height*zoom}}/>}
   </div>
  </div></div>
 </main>;
}
