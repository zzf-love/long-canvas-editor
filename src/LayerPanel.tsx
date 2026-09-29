import {useEffect,useMemo,useRef,useState} from 'react';
import type {PointerEvent as ReactPointerEvent} from 'react';
import {ArrowDown,ArrowUp,ChevronDown,ChevronRight,ChevronsDown,ChevronsUp,Eye,EyeOff,GripVertical,Image as ImageIcon,Layers,Link2,Lock,Search,Square,Type,Unlink,Unlock} from 'lucide-react';
import type {DesignElement,DesignPage,Project} from './types';
import {decodeElementKey,elementKey} from './longLayout';
import {expandLinkedSelection,isLayerBackdrop,reorderLayers} from './layers';
import {textStyle} from './text';
import './layers.css';

type Props={
 project:Project;page:DesignPage;selected:string[];
 onSelect:(keys:string[],direct?:boolean)=>void;
 onToggleHidden:(key:string)=>void;onToggleLocked:(key:string)=>void;
 onLink:()=>void;onUnlink:()=>void;
 onOrder:(direction:'up'|'down'|'front'|'back')=>void;
 onReorder:(movingKeys:string[],targetKey:string,placement:'before'|'after')=>void;
};
const typeLabels={text:'文字',image:'图片',shape:'图形',group:'组合'};
const typeIcons={text:Type,image:ImageIcon,shape:Square,group:Layers};
const orderButtons=[['front',ChevronsUp,'置顶'],['up',ArrowUp,'上移一层'],['down',ArrowDown,'下移一层'],['back',ChevronsDown,'置底']] as const;
type DropTarget={key:string;edge:'top'|'bottom'};

function layerLabel(element:DesignElement){
 if(element.type==='text'){
  const content=textStyle(element)?.content.replace(/\s+/g,' ').trim();
  if(content)return content;
 }
 return element.name||typeLabels[element.type];
}

export default function LayerPanel(p:Props){
 const [collapsed,setCollapsed]=useState(false),[query,setQuery]=useState('');
 const [dragKeys,setDragKeys]=useState<string[]>([]),[dropTarget,setDropTarget]=useState<DropTarget|null>(null);
 const listRef=useRef<HTMLDivElement>(null),rowRefs=useRef(new Map<string,HTMLDivElement>()),previousSelection=useRef<string[]>([]);
 const cancelDragRef=useRef<(()=>void)|null>(null),suppressClickRef=useRef(false);
 const rows=useMemo(()=>[
  ...p.page.elements.filter(element=>!isLayerBackdrop(element,p.page)).reverse(),
  ...p.page.elements.filter(element=>isLayerBackdrop(element,p.page)).reverse(),
 ].map(element=>({element,key:elementKey(p.page.id,element.id),label:layerLabel(element)})),[p.page]);
 const visibleRows=useMemo(()=>{const search=query.trim().toLocaleLowerCase();return search?rows.filter(row=>`${row.label} ${row.element.name} ${typeLabels[row.element.type]}`.toLocaleLowerCase().includes(search)):rows},[query,rows]);
 const selectedSet=useMemo(()=>new Set(p.selected),[p.selected]);
 const selectedElements=useMemo(()=>p.project.pages.flatMap(page=>page.elements.filter(element=>selectedSet.has(elementKey(page.id,element.id)))),[p.project.pages,selectedSet]);
 const canLink=selectedElements.filter(element=>!element.locked&&!element.hidden).length>1;
 const canUnlink=selectedElements.some(element=>!!element.linkId);
 const orderAvailable=useMemo(()=>Object.fromEntries(orderButtons.map(([direction])=>[direction,reorderLayers(p.project,p.selected,direction)!==p.project])),[p.project,p.selected]);
 const selectedHere=rows.filter(row=>selectedSet.has(row.key)).length;

 useEffect(()=>{setQuery('');cancelDragRef.current?.();setDropTarget(null);setDragKeys([])},[p.page.id]);
 useEffect(()=>()=>cancelDragRef.current?.(),[]);
 useEffect(()=>{
  if(collapsed||dragKeys.length)return;
  const added=p.selected.filter(key=>!previousSelection.current.includes(key));
  const key=[...added].reverse().find(item=>rowRefs.current.has(item))||p.selected.find(item=>rowRefs.current.has(item));
  const row=key?rowRefs.current.get(key):undefined,list=listRef.current;
  if(row&&list){
   const bounds=row.getBoundingClientRect(),viewport=list.getBoundingClientRect();
   if(bounds.top<viewport.top)list.scrollTop-=viewport.top-bounds.top;
   else if(bounds.bottom>viewport.bottom)list.scrollTop+=bounds.bottom-viewport.bottom;
  }
  previousSelection.current=p.selected;
 },[p.selected,p.page.id,collapsed,query,dragKeys]);

 const selectRow=(key:string,event:{shiftKey:boolean;metaKey:boolean;ctrlKey:boolean;altKey:boolean})=>{
  if(event.altKey){p.onSelect([key],true);return}
  if(event.shiftKey||event.metaKey||event.ctrlKey){
   const peers=expandLinkedSelection(p.project,[key]);
   p.onSelect(selectedSet.has(key)?p.selected.filter(item=>!peers.includes(item)):[...new Set([...p.selected,...peers])]);
  }else p.onSelect([key]);
 };
 const startPointerDrag=(key:string,element:DesignElement,event:ReactPointerEvent<HTMLDivElement>)=>{
  if(event.button!==0||element.locked||(event.target as Element).closest('.layers-row-action'))return;
  cancelDragRef.current?.();suppressClickRef.current=false;
  const direct=event.altKey,active=selectedSet.has(key),additive=event.shiftKey||event.metaKey||event.ctrlKey;
  const peers=direct?[key]:expandLinkedSelection(p.project,[key]);
  const candidates=direct?[key]:active?p.selected:additive?[...new Set([...p.selected,...peers])]:peers;
  const keys=candidates.filter(item=>{const decoded=decodeElementKey(item);return decoded?.pageId===p.page.id&&!p.page.elements.find(layer=>layer.id===decoded.elementId)?.locked});
  if(!keys.length)return;
  const pointerId=event.pointerId,startX=event.clientX,startY=event.clientY;
  let x=startX,y=startY,started=false,frame=0,target:DropTarget|null=null;
  const updateTarget=(next:DropTarget|null)=>{if(next?.key===target?.key&&next?.edge===target?.edge)return;target=next;setDropTarget(next)};
  const locateTarget=()=>{
   const list=listRef.current;if(!list){updateTarget(null);return}
   const viewport=list.getBoundingClientRect();
   if(x<viewport.left||x>viewport.right||y<viewport.top-24||y>viewport.bottom+24){updateTarget(null);return}
   const pointY=Math.max(viewport.top+1,Math.min(viewport.bottom-1,y));
   const visible=visibleRows.flatMap(row=>{const node=rowRefs.current.get(row.key);if(!node)return [];const bounds=node.getBoundingClientRect();return bounds.bottom>viewport.top&&bounds.top<viewport.bottom?[{...row,bounds}]:[]});
   let row=visible.find(item=>pointY>=item.bounds.top&&pointY<=item.bounds.bottom);
   if(!row&&visible.length)row=pointY<visible[0].bounds.top?visible[0]:visible[visible.length-1];
   if(!row||keys.includes(row.key)||isLayerBackdrop(row.element,p.page)){updateTarget(null);return}
   updateTarget({key:row.key,edge:pointY<row.bounds.top+row.bounds.height/2?'top':'bottom'});
  };
  const autoScroll=()=>{
   if(!started)return;
   const list=listRef.current;
   if(list){const bounds=list.getBoundingClientRect();if(x>=bounds.left&&x<=bounds.right&&y>=bounds.top-24&&y<=bounds.bottom+24){
    const edge=25,speed=y<bounds.top+edge?-Math.ceil((bounds.top+edge-y)/3):y>bounds.bottom-edge?Math.ceil((y-bounds.bottom+edge)/3):0;
    if(speed)list.scrollTop+=Math.max(-14,Math.min(14,speed));
   }}
   locateTarget();frame=requestAnimationFrame(autoScroll);
  };
  const cleanUp=(commit:boolean)=>{
   cancelAnimationFrame(frame);window.removeEventListener('pointermove',move);window.removeEventListener('pointerup',up);window.removeEventListener('pointercancel',cancel);window.removeEventListener('blur',cancel);
   cancelDragRef.current=null;setDragKeys([]);setDropTarget(null);
   if(started){suppressClickRef.current=true;window.setTimeout(()=>{suppressClickRef.current=false},250);if(commit&&target)p.onReorder(keys,target.key,target.edge==='top'?'after':'before')}
  };
  const move=(moveEvent:PointerEvent)=>{
   if(moveEvent.pointerId!==pointerId)return;x=moveEvent.clientX;y=moveEvent.clientY;
   if(!started&&Math.hypot(x-startX,y-startY)<4)return;
   moveEvent.preventDefault();
   if(!started){started=true;setDragKeys(keys);if(!active||direct||additive)p.onSelect(keys,direct);frame=requestAnimationFrame(autoScroll)}
   locateTarget();
  };
  const up=(upEvent:PointerEvent)=>{if(upEvent.pointerId!==pointerId)return;x=upEvent.clientX;y=upEvent.clientY;if(started){upEvent.preventDefault();locateTarget()}cleanUp(true)};
  const cancel=()=>cleanUp(false);
  cancelDragRef.current=cancel;
  window.addEventListener('pointermove',move,{passive:false});window.addEventListener('pointerup',up);window.addEventListener('pointercancel',cancel);window.addEventListener('blur',cancel);
 };

 return <section className={`layers-panel${collapsed?' is-collapsed':''}${dragKeys.length?' is-sorting':''}`} aria-label="画布图层面板" onPointerDownCapture={()=>{suppressClickRef.current=false}} onClickCapture={event=>{if(suppressClickRef.current){event.preventDefault();event.stopPropagation();suppressClickRef.current=false}}}>
  <div className="layers-heading">
   <button className="layers-collapse" aria-label={collapsed?'展开图层面板':'收起图层面板'} aria-expanded={!collapsed} onClick={()=>setCollapsed(value=>!value)}>
    {collapsed?<ChevronRight size={15}/>:<ChevronDown size={15}/>}<h2>图层</h2><span className="layers-count">{selectedHere?`${selectedHere} / `:''}{rows.length}</span>
   </button>
   <span className="layers-section-name" title={p.page.title}>{p.page.title}</span>
  </div>
  {!collapsed&&<>
   <div className="layers-controls">
    <label className="layers-search"><Search size={13}/><input aria-label="搜索图层" placeholder="搜索文字或图层名" value={query} onChange={event=>setQuery(event.target.value)}/>{query&&<button type="button" aria-label="清空图层搜索" onClick={()=>setQuery('')}>×</button>}</label>
    <div className="layers-actions">
     <button className="layers-link-action" title="将所选对象链接，之后可一起移动和缩放" aria-label="链接所选对象" disabled={!canLink} onClick={p.onLink}><Link2 size={14}/>链接</button>
     <button className="layers-link-action" title="取消所选对象之间的链接" aria-label="取消对象链接" disabled={!canUnlink} onClick={p.onUnlink}><Unlink size={14}/>取消链接</button>
     <span className="layers-action-divider"/>
     {orderButtons.map(([direction,Icon,label])=><button className="layers-order-action" key={direction} title={label} aria-label={`图层${label}`} disabled={!orderAvailable[direction]} onClick={()=>p.onOrder(direction)}><Icon size={14}/></button>)}
    </div>
   </div>
   <div className="layers-list-caption"><span>{query?`找到 ${visibleRows.length} 个图层`:'上方图层显示在前面'}</span><span>拖动可排序</span></div>
   <div className="layers-rows" ref={listRef} aria-label="当前分屏图层列表">
    {!visibleRows.length&&<p className="layers-empty">{query?'没有找到匹配图层':'这个分屏还没有图层'}</p>}
    {visibleRows.map(({element,key,label})=>{
     const Icon=typeIcons[element.type],active=selectedSet.has(key),drop=dropTarget?.key===key?dropTarget.edge:null;
     return <div key={key} data-layer-key={key} data-layer-id={element.id} ref={node=>{if(node)rowRefs.current.set(key,node);else rowRefs.current.delete(key)}}
      className={`layers-row${active?' is-selected':''}${element.hidden?' is-hidden':''}${element.locked?' is-locked':''}${drop?` drop-${drop}`:''}${dragKeys.includes(key)?' is-dragging':''}`}
      onPointerDown={event=>startPointerDrag(key,element,event)} onDragStart={event=>event.preventDefault()}>
      <GripVertical className="layers-grip" size={11} aria-hidden="true"/>
      <button className="layers-select-row" aria-label={`选择图层：${label}（${element.id}）`} aria-pressed={active} title={`${label}\n${element.name} · ${typeLabels[element.type]}${element.linkId?' · 已链接，Alt 单击可单选':''}`} onClick={event=>selectRow(key,event)}>
       <span className={`layers-type-icon type-${element.type}`}><Icon size={13}/></span><span className="layers-name">{label}</span>
       {element.linkId&&<Link2 className="layers-link-mark" size={12} aria-label="已链接"/>}
      </button>
      <button className={`layers-row-action${element.hidden?' is-on':''}`} aria-label={`${element.hidden?'显示':'隐藏'}图层：${label}（${element.id}）`} title={element.hidden?'显示图层':'隐藏图层'} aria-pressed={element.hidden} onClick={()=>p.onToggleHidden(key)}>{element.hidden?<EyeOff size={13}/>:<Eye size={13}/>}</button>
      <button className={`layers-row-action${element.locked?' is-on':''}`} aria-label={`${element.locked?'解锁':'锁定'}图层：${label}（${element.id}）`} title={element.locked?'解锁图层':'锁定图层'} aria-pressed={element.locked} onClick={()=>p.onToggleLocked(key)}>{element.locked?<Lock size={12}/>:<Unlock size={12}/>}</button>
     </div>;
    })}
   </div>
   <p className="layers-tip">Shift / ⌘ 多选 · Alt 单选链接对象</p>
  </>}
 </section>;
}
