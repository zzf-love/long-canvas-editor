import {useEffect,useRef,useState} from 'react';

type Props={values:number[];editableCount:number;onChange:(opacity:number)=>void;begin:()=>void;commit:()=>void};
export default function OpacityControl({values,editableCount,onChange,begin,commit}:Props){
 const value=values[0]??1,mixed=values.some(item=>Math.abs(item-value)>.00001),percent=Math.round(value*100);
 const [draft,setDraft]=useState(mixed?'':String(percent));
 const dragging=useRef(false),disabled=editableCount===0;
 useEffect(()=>setDraft(mixed?'':String(percent)),[percent,mixed]);
 useEffect(()=>{
  const end=()=>{if(dragging.current){dragging.current=false;commit()}};
  window.addEventListener('pointerup',end);window.addEventListener('pointercancel',end);window.addEventListener('blur',end);
  return()=>{window.removeEventListener('pointerup',end);window.removeEventListener('pointercancel',end);window.removeEventListener('blur',end);end()};
 },[commit]);
 const setPercent=(next:number)=>{if(disabled||!Number.isFinite(next))return;begin();onChange(Math.min(100,Math.max(0,next))/100)};
 return <div className="inspector-section opacity-panel">
  <div className="section-title"><h3>不透明度</h3><span className="opacity-state">{mixed?'数值不同':percent===100?'完全显示':percent===0?'完全透明':''}</span></div>
  <div className="opacity-controls"><input type="range" aria-label="不透明度滑杆" aria-valuetext={mixed?'所选图层数值不同':`${percent}%`} min="0" max="100" step="1" value={percent} disabled={disabled} onPointerDown={()=>{dragging.current=true;begin()}} onChange={e=>setPercent(Number(e.target.value))} onKeyUp={commit} onBlur={()=>{dragging.current=false;commit()}}/>
   <label className="opacity-number"><input type="number" aria-label="不透明度百分比" min="0" max="100" step="1" placeholder={mixed?'混合':''} value={draft} disabled={disabled} onFocus={begin} onChange={e=>{setDraft(e.target.value);if(e.target.value.trim()!=='')setPercent(Number(e.target.value))}} onBlur={()=>{setDraft(mixed?'':String(percent));commit()}} onKeyDown={e=>{if(e.key==='Enter')e.currentTarget.blur()}}/><span>%</span></label>
  </div>
  <p className="help-text compact">{disabled?'解锁并显示图层后可调整。':editableCount>1?`同时设置 ${editableCount} 个图层的不透明度。`:'数值越低越通透，可用来调浅遮罩。'}</p>
 </div>;
}
