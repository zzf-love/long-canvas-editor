import {useEffect,useLayoutEffect,useMemo,useRef,useState} from 'react';
import type {Project,DesignPage,Box,Guide,SnapLine} from './types';
import Artwork from './Artwork';
import {isPageBackground,snapMove,unionBoxes,visualBox} from './geometry';
import {applyFlatTransforms,decodeElementKey,pageOffsets,relocateElements,relocateElementsWithSelection} from './longLayout';
import {expandLinkedSelection} from './layers';
import {normalizeSectionHeight,resizeSection} from './sectionResize';
type Props={project:Project;page:DesignPage;flat:DesignPage;selected:string[];setSelected:(s:string[],direct?:boolean)=>string[];setActivePage:(id:string)=>void;jump:{id:string;token:number;edge?:'bottom';box?:Box}|null;zoom:number;snap:boolean;showGuides:boolean;showSectionResize:boolean;updateProject:(fn:(p:Project)=>Project,record?:boolean)=>void;begin:()=>void;commit:()=>void;onMeasure:(boxes:Record<string,Box>)=>void;editText:()=>void};
export default function LongCanvas(p:Props){
 const {selected,zoom,flat}=p,board=useRef<HTMLDivElement>(null),scroll=useRef<HTMLDivElement>(null),dragging=useRef(false),stopDrag=useRef<(()=>void)|null>(null);
 const [lines,setLines]=useState<SnapLine[]>([]),[marquee,setMarquee]=useState<Box|null>(null),[resizeStart,setResizeStart]=useState<number|null>(null);
 const skipScrollTop=useRef<number|null>(null);
 const layout=useMemo(()=>pageOffsets(p.project),[p.project.pages]);
 const snapScene=useMemo(()=>({...flat,elements:flat.elements.filter(e=>{if(!e.locked)return true;const d=decodeElementKey(e.id),source=d&&p.project.pages.find(pg=>pg.id===d.pageId),el=source?.elements.find(a=>a.id===d?.elementId);return !!source&&!!el&&!isPageBackground(el,source)}),guides:[...flat.guides,...layout.flatMap(({page,top})=>[top,top+page.height/2,top+page.height].map(value=>({id:`boundary-${page.id}-${value}`,axis:'y' as const,value})))]}),[flat,p.project.pages,layout]);
 const items=flat.elements.filter(e=>selected.includes(e.id)&&!e.hidden),editable=items.filter(e=>!e.locked),box=editable.length?unionBoxes(editable.map(visualBox)):null;
 const point=(e:{clientX:number;clientY:number})=>{const r=board.current!.getBoundingClientRect();return{x:(e.clientX-r.left)/zoom,y:(e.clientY-r.top)/zoom}};
 const previousZoom=useRef(zoom);
 useLayoutEffect(()=>{const s=scroll.current;if(s&&previousZoom.current!==zoom){s.scrollTop*=zoom/previousZoom.current;previousZoom.current=zoom}},[zoom]);
 useEffect(()=>{const s=scroll.current;if(!p.jump||!s)return;const found=layout.find(x=>x.page.id===p.jump!.id);if(found){const box=p.jump.box;if(box&&box.y*zoom>=s.scrollTop+32&&(box.y+box.height)*zoom<=s.scrollTop+s.clientHeight-32)return;const desired=box?box.y*zoom-Math.max(40,(s.clientHeight-box.height*zoom)/2):p.jump.edge==='bottom'?(found.top+found.page.height)*zoom-s.clientHeight*.65:found.top*zoom;const top=Math.max(0,Math.min(desired,s.scrollHeight-s.clientHeight));if(Math.abs(top-s.scrollTop)>.5){skipScrollTop.current=top;s.scrollTo({top,behavior:'instant'})}}},[p.jump]);
 useEffect(()=>()=>stopDrag.current?.(),[]);
 const listen=(move:(e:PointerEvent)=>void,end:(e:PointerEvent)=>void)=>{
  dragging.current=true;const cleanup=()=>{window.removeEventListener('pointermove',move);window.removeEventListener('pointerup',done);window.removeEventListener('pointercancel',done);dragging.current=false;stopDrag.current=null};
  const done=(e:PointerEvent)=>{cleanup();end(e)};window.addEventListener('pointermove',move);window.addEventListener('pointerup',done);window.addEventListener('pointercancel',done);stopDrag.current=cleanup;
 };
 const startMove=(e:React.PointerEvent,ids:string[])=>{
  if(e.button!==0)return;e.preventDefault();const origin=point(e),snapshot=p.project,scene=snapScene;
  const movable=ids.filter(id=>{const el=scene.elements.find(x=>x.id===id);return el&&!el.locked&&!el.hidden});if(!movable.length)return;
  p.begin();let delta={dx:0,dy:0},changed=false,last:PointerEvent|null=null,frame=0;
  const move=(ev:PointerEvent)=>{last=ev;const pos=point(ev);let dx=pos.x-origin.x,dy=pos.y-origin.y;const locked=ev.shiftKey?(Math.abs(dx)>Math.abs(dy)?'y':'x'):null;if(locked==='y')dy=0;else if(locked==='x')dx=0;
   const result=p.snap&&!ev.altKey?snapMove(scene,movable,dx,dy,6/zoom):{dx,dy,lines:[]};if(locked){if(locked==='x')result.dx=0;else result.dy=0;result.lines=result.lines.filter(l=>l.axis!==locked)}
   delta=result;changed=Math.abs(result.dx)+Math.abs(result.dy)>.1;setLines(result.lines);p.updateProject(()=>relocateElements(snapshot,movable,result.dx,result.dy,false),false);
  };
  const autoScroll=()=>{const s=scroll.current;if(s&&last){const r=s.getBoundingClientRect(),edge=44;const speed=last.clientY<r.top+edge?-Math.min(16,(r.top+edge-last.clientY)/3):last.clientY>r.bottom-edge?Math.min(16,(last.clientY-r.bottom+edge)/3):0;if(speed){const before=s.scrollTop;s.scrollTop+=speed;if(before!==s.scrollTop)move(last)}}frame=requestAnimationFrame(autoScroll)};
  frame=requestAnimationFrame(autoScroll);
  listen(move,()=>{cancelAnimationFrame(frame);setLines([]);if(changed){const result=relocateElementsWithSelection(snapshot,movable,delta.dx,delta.dy,true);p.updateProject(()=>result.project,false);p.setSelected(result.selected,true)}p.commit()});
  const stop=stopDrag.current;stopDrag.current=()=>{cancelAnimationFrame(frame);stop?.()};
 };
 const pointerDown=(e:React.PointerEvent)=>{
  if(e.button!==0)return;const id=(e.target as Element).closest('[data-element-id]')?.getAttribute('data-element-id');
  if(id){let ids=selected;if(e.shiftKey||e.metaKey||e.ctrlKey){const peers=expandLinkedSelection(p.project,[id]);p.setSelected(selected.includes(id)?selected.filter(x=>!peers.includes(x)):[...selected,id]);return}if(!selected.includes(id)){ids=p.setSelected([id])}startMove(e,ids);return}
  if((e.target as Element).closest('.handle,.guide-line'))return;e.preventDefault();const origin=point(e),hit=layout.find(x=>origin.y>=x.top&&origin.y<x.top+x.page.height);if(hit)p.setActivePage(hit.page.id);if(!e.shiftKey)p.setSelected([]);
  const prev=e.shiftKey?selected:[];let bounds:Box|null=null;
  listen(ev=>{const pt=point(ev);bounds={x:Math.min(origin.x,pt.x),y:Math.min(origin.y,pt.y),width:Math.abs(pt.x-origin.x),height:Math.abs(pt.y-origin.y)};setMarquee(bounds)},()=>{if(bounds&&bounds.width>3&&bounds.height>3){const b=bounds;p.setSelected([...new Set([...prev,...flat.elements.filter(el=>{const z=visualBox(el);return !el.hidden&&!el.locked&&z.x>=b.x&&z.y>=b.y&&z.x+z.width<=b.x+b.width&&z.y+z.height<=b.y+b.height}).map(el=>el.id)])])}setMarquee(null)});
 };
 const guideDrag=(e:React.PointerEvent,axis:'x'|'y',existing?:Guide)=>{
  e.preventDefault();e.stopPropagation();p.begin();const decoded=existing&&decodeElementKey(existing.id),owner=decoded?.pageId||p.page.id,localId=decoded?.elementId||crypto.randomUUID();
  const top=layout.find(x=>x.page.id===owner)?.top||0,initial=existing?.value??point(e)[axis];
  const set=(value:number,remove=false)=>p.updateProject(pr=>({...pr,pages:pr.pages.map(pg=>{const kept=pg.guides.filter(g=>!(pg.id===owner&&g.id===localId)&&!(existing&&axis==='x'&&g.axis==='x'&&g.value===existing.value));return {...pg,guides:pg.id===owner&&!remove?[...kept,{id:localId,axis,value:value-(axis==='y'?top:0)}]:kept}})}),false);
  if(!existing)set(initial);
  listen(ev=>set(Math.round(point(ev)[axis])),ev=>{const v=Math.round(point(ev)[axis]);set(v,v<0||v>(axis==='x'?790:flat.height));p.commit()});
 };
 const resize=(e:React.PointerEvent)=>{e.preventDefault();e.stopPropagation();if(!box)return;const start=point(e),snapshot=flat;p.begin();listen(ev=>{const pt=point(ev),factor=Math.max(.03,(box.width+pt.x-start.x)/Math.max(1,box.width));const next={...snapshot,elements:snapshot.elements.map(el=>{if(!selected.includes(el.id)||el.locked||el.hidden)return el;const b=visualBox(el);return{...el,sx:el.sx*factor,sy:el.sy*factor,tx:box.x+(b.x-box.x)*factor-el.bbox.x,ty:box.y+(b.y-box.y)*factor-el.bbox.y}})};p.updateProject(pr=>applyFlatTransforms(pr,next),false)},()=>p.commit())};
 const resizePage=(e:React.PointerEvent)=>{
  if(e.button!==0)return;e.preventDefault();e.stopPropagation();
  const snapshot=p.project,id=p.page.id,height=p.page.height,origin=point(e).y;
  let last:PointerEvent|null=null,frame=0;
  p.begin();setResizeStart(height);
  const move=(ev:PointerEvent)=>{last=ev;const value=normalizeSectionHeight(height+point(ev).y-origin);p.updateProject(()=>resizeSection(snapshot,id,value),false)};
  const autoScroll=()=>{const s=scroll.current;if(s&&last){const r=s.getBoundingClientRect(),edge=44;const speed=last.clientY<r.top+edge?-Math.min(12,(r.top+edge-last.clientY)/3):last.clientY>r.bottom-edge?Math.min(12,(last.clientY-r.bottom+edge)/3):0;if(speed){const before=s.scrollTop;s.scrollTop+=speed;if(before!==s.scrollTop)move(last)}}frame=requestAnimationFrame(autoScroll)};
  frame=requestAnimationFrame(autoScroll);
  listen(move,ev=>{cancelAnimationFrame(frame);if(ev.type==='pointercancel')p.updateProject(()=>snapshot,false);setResizeStart(null);p.commit()});
  const stop=stopDrag.current;stopDrag.current=()=>{cancelAnimationFrame(frame);stop?.()};
 };
 const activeTop=layout.find(x=>x.page.id===p.page.id)?.top||0;
 const ruler=(axis:'x'|'y')=>{const max=axis==='x'?790:flat.height;return <svg className={`ruler ruler-${axis}`} width={axis==='x'?790*zoom:24} height={axis==='y'?max*zoom:24} onPointerDown={e=>guideDrag(e,axis==='x'?'y':'x')} aria-label={axis==='x'?'从顶部标尺拖出水平参考线':'从左侧标尺拖出垂直参考线'}>{Array.from({length:Math.floor(max/20)+1},(_,i)=>{const n=i*20,major=n%100===0,pos=n*zoom;return <g key={n}>{axis==='x'?<><line x1={pos} x2={pos} y1={major?14:19} y2={24}/>{major&&<text x={pos+3} y={10}>{n}</text>}</>:<><line x1={major?14:19} x2={24} y1={pos} y2={pos}/>{major&&<text x={3} y={pos+11} transform={`rotate(-90 3 ${pos+11})`}>{n}</text>}</>}</g>})}</svg>};
 const visibleGuides=flat.guides.filter((g,i,all)=>g.axis==='y'||all.findIndex(a=>a.axis==='x'&&a.value===g.value)===i);
 return <main className="workspace long-canvas">
  <div className="canvas-caption"><b>连续长画布</b><span>790 × {flat.height} px</span><span className="current-section">{layout.findIndex(x=>x.page.id===p.page.id)+1} / {layout.length} · {p.page.title}</span><span>{Math.round(zoom*100)}%</span></div>
  <div ref={scroll} className="canvas-scroll" onScroll={()=>{if(!scroll.current)return;if(skipScrollTop.current!==null){const skip=Math.abs(skipScrollTop.current-scroll.current.scrollTop)<1;skipScrollTop.current=null;if(skip)return}if(dragging.current||selected.length)return;const y=(scroll.current.scrollTop+Math.min(200,scroll.current.clientHeight*.3))/zoom;const hit=layout.find(x=>y>=x.top&&y<x.top+x.page.height);if(hit&&hit.page.id!==p.page.id)p.setActivePage(hit.page.id)}}><div className="board-wrap" style={{width:790*zoom,height:flat.height*zoom}}>
   <div className="top-ruler">{ruler('x')}</div>{ruler('y')}
   {layout.map(({page,top,index})=><button className={`section-marker ${page.id===p.page.id?'active':''}`} key={page.id} style={{top:top*zoom}} aria-label={`定位第${index+1}屏 ${page.title}`} onClick={()=>{p.setSelected([]);p.setActivePage(page.id);scroll.current?.scrollTo({top:top*zoom,behavior:'instant'})}} title={`${page.title} · Y ${top}`}>{String(index+1).padStart(2,'0')}</button>)}
   <div ref={board} className="board" data-testid="canvas" style={{width:790*zoom,height:flat.height*zoom}} onPointerDown={pointerDown} onDoubleClick={e=>{if((e.target as Element).closest('[data-element-id]'))p.editText()}}>
    <Artwork project={p.project} page={flat} interactive onMeasure={p.onMeasure} style={{width:790*zoom,height:flat.height*zoom}}/>
    {p.showGuides&&visibleGuides.map(g=><div key={g.id} role="separator" aria-label={`${g.axis==='x'?'垂直':'水平'}参考线 ${g.value}`} className={`guide-line guide-${g.axis}`} style={g.axis==='x'?{left:g.value*zoom}:{top:g.value*zoom}} onPointerDown={e=>guideDrag(e,g.axis,g)} onDoubleClick={e=>{e.stopPropagation();const d=decodeElementKey(g.id);if(d)p.updateProject(pr=>({...pr,pages:pr.pages.map(pg=>({...pg,guides:pg.guides.filter(a=>!(pg.id===d.pageId&&a.id===d.elementId)&&!(g.axis==='x'&&a.axis==='x'&&a.value===g.value))}))}))}}><span>{Math.round(g.value)}</span></div>)}
    {lines.map((l,i)=><div key={i} className={`snap-line guide-${l.axis}`} style={l.axis==='x'?{left:l.value*zoom}:{top:l.value*zoom}}/>)}
    {items.map(el=>{const b=visualBox(el);return <div key={el.id} className={`selection ${el.locked?'is-locked':''}`} style={{left:b.x*zoom,top:b.y*zoom,width:b.width*zoom,height:b.height*zoom}}/>})}
    {box&&<div className="selection group-selection" style={{left:box.x*zoom,top:box.y*zoom,width:box.width*zoom,height:box.height*zoom}}><span className="handle tl"/><span className="handle tr"/><span className="handle bl"/><button className="handle br" aria-label="等比缩放选中元素" onPointerDown={resize}/></div>}
    {marquee&&<div className="marquee" style={{left:marquee.x*zoom,top:marquee.y*zoom,width:marquee.width*zoom,height:marquee.height*zoom}}/>}
   </div>
   {p.showSectionResize&&<div className={`section-resize-edge ${resizeStart!==null?'is-resizing':''}`} style={{top:(activeTop+p.page.height)*zoom}} onPointerDown={resizePage}>
    <button className="section-resize-handle" aria-label={`拖动调整当前分屏高度 ${p.page.title}`} title="上下拖动调整本屏高度；方向键调整10px，Shift调整100px" onKeyDown={e=>{if(!['ArrowUp','ArrowDown'].includes(e.key))return;e.preventDefault();e.stopPropagation();p.updateProject(pr=>resizeSection(pr,p.page.id,p.page.height+(e.key==='ArrowUp'?-1:1)*(e.shiftKey?100:10)))}}>
     <span aria-hidden="true">↕</span><span>{resizeStart!==null?'调整中':'拉动底边'} · {p.page.height} px</span>{resizeStart!==null&&p.page.height!==resizeStart&&<small>{p.page.height>resizeStart?'+':''}{p.page.height-resizeStart}</small>}
    </button>
   </div>}
  </div></div>
 </main>;
}
