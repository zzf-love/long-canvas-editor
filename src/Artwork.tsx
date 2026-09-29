import {memo,useId,useLayoutEffect,useRef,useMemo} from 'react';
import type {DesignPage,Project,Box} from './types';
import {prefixSvgIds,resolveMarkup} from './svg';
type Props={project:Project;page:DesignPage;onMeasure?:(boxes:Record<string,Box>)=>void;interactive?:boolean;style?:React.CSSProperties};
export default memo(function Artwork({project,page,onMeasure,interactive=false,style}:Props){
 const id=useId().replace(/[^a-zA-Z0-9]/g,''),ref=useRef<SVGSVGElement>(null),factor=page.width/page.sourceWidth;
 const markupKey=page.elements.map(e=>e.id+e.markup).join('');
 const prepared=useMemo(()=>new Map(page.elements.map(e=>[e.id,prefixSvgIds(resolveMarkup(e.markup,project.assets),id)])),[markupKey,project.assets,id]);
 const definitions=useMemo(()=>prefixSvgIds(page.defs,id),[page.defs,id]);
 useLayoutEffect(()=>{
  if(!onMeasure||!ref.current)return;
  let alive=true;
  const measure=()=>{if(!alive)return;const result:Record<string,Box>={};ref.current?.querySelectorAll<SVGGElement>('[data-measure]').forEach(g=>{try{
   if(page.elements.find(e=>e.id===g.dataset.measure)?.type==='image')return;
   const first=g.firstElementChild;
   // Nested SVGs crop product photos. Their selection box is the viewport,
   // not the full, partly invisible image returned by the group's getBBox().
   const b=first instanceof SVGSVGElement?{x:first.x.baseVal.value,y:first.y.baseVal.value,width:first.width.baseVal.value,height:first.height.baseVal.value}:g.getBBox();
   if(b.width>0&&b.height>0)result[g.dataset.measure!]={x:b.x*factor,y:b.y*factor,width:b.width*factor,height:b.height*factor};
  }catch{}});onMeasure(result)};
  measure();document.fonts.ready.then(measure);return()=>{alive=false};
 },[page.elements.map(e=>e.markup).join(''),factor,onMeasure]);
 return <svg ref={ref} className="artwork" xmlns="http://www.w3.org/2000/svg" width={page.width} height={page.height} viewBox={`0 0 ${page.width} ${page.height}`} style={style}>
  <defs dangerouslySetInnerHTML={{__html:definitions}}/>
  {page.elements.filter(e=>!e.hidden).map(e=><g key={e.id} data-element-id={e.id} opacity={e.opacity} className={interactive&&!e.locked?'editable-element':''} style={{pointerEvents:interactive?(e.locked?'none':'visiblePainted'):'none'}} transform={`translate(${e.tx} ${e.ty}) translate(${e.bbox.x} ${e.bbox.y}) scale(${e.sx} ${e.sy}) translate(${-e.bbox.x} ${-e.bbox.y})`}>
   <g transform={`scale(${factor})`}><g data-measure={e.id} dangerouslySetInnerHTML={{__html:prepared.get(e.id)!}}/></g>
  </g>)}
 </svg>
},(a,b)=>a.page===b.page&&a.project.assets===b.project.assets&&a.interactive===b.interactive&&a.onMeasure===b.onMeasure&&a.style?.width===b.style?.width&&a.style?.height===b.style?.height);
