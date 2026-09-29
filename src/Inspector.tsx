import {useEffect,useState} from 'react';
import {AlignLeft,AlignCenter,AlignRight,AlignStartVertical,AlignCenterVertical,AlignEndVertical,ArrowUp,ArrowDown,Copy,Trash2,Lock,Unlock,Plus,Image as ImageIcon,ChevronsLeftRight,ChevronsUpDown} from 'lucide-react';
import type {DesignPage,DesignElement,AlignMode,Box} from './types';
import {visualBox} from './geometry';
import {textStyle,changeText,shapeFill,changeShapeFill} from './text';
import OpacityControl from './OpacityControl';
import {MIN_SECTION_HEIGHT,MAX_SECTION_HEIGHT} from './sectionResize';

export const alignButtons:[AlignMode,typeof AlignLeft,string][]=[['left',AlignLeft,'左对齐'],['centerX',AlignCenter,'水平居中'],['right',AlignRight,'右对齐'],['top',AlignStartVertical,'顶部对齐'],['centerY',AlignCenterVertical,'垂直居中'],['bottom',AlignEndVertical,'底部对齐']];
export function NumberField({label,value,onChange,begin,commit,min,max,step=1,unit=''}:{label:string;value:number;onChange:(v:number)=>void;begin:()=>void;commit:()=>void;min?:number;max?:number;step?:number;unit?:string}){
 const [draft,setDraft]=useState(String(Math.round(value*100)/100));useEffect(()=>setDraft(String(Math.round(value*100)/100)),[value]);
 return <label className="number-field"><span>{label}</span><div><input aria-label={label} type="number" value={draft} min={min} max={max} step={step} onFocus={begin} onChange={e=>{setDraft(e.target.value);if(e.target.value!==''&&Number.isFinite(Number(e.target.value))){let v=Number(e.target.value);if(min!==undefined)v=Math.max(min,v);if(max!==undefined)v=Math.min(max,v);onChange(v)}}} onBlur={()=>{setDraft(String(Math.round(value*100)/100));commit()}}/>{unit&&<small>{unit}</small>}</div></label>;
}
type Props={opacityValues:number[];opacityEditableCount:number;changeOpacity:(value:number)=>void;orderSelection:(direction:'up'|'down'|'front'|'back')=>void;selectionBox?:Box;transformSelection?:(patch:{x?:number;y?:number;width?:number;height?:number})=>void;page:DesignPage;resizePage:(height:number,record?:boolean)=>void;showPageBottom:()=>void;pageOffset?:number;canvasHeight?:number;guidePage?:DesignPage;updateGuides?:(fn:(p:DesignPage)=>DesignPage,record?:boolean)=>void;selected:string[];updatePage:(fn:(p:DesignPage)=>DesignPage,record?:boolean)=>void;begin:()=>void;commit:()=>void;align:(mode:AlignMode)=>void;target:'page'|'selection';setTarget:(v:'page'|'selection')=>void;distribute:(axis:'x'|'y')=>void;duplicate:()=>void;remove:()=>void;replaceImage:()=>void;textRef:React.RefObject<HTMLTextAreaElement|null>};
export default function Inspector(p:Props){
 const el=p.page.elements.find(x=>x.id===p.selected[0]),single=p.selected.length===1&&el?el:null,style=single?.type==='text'?textStyle(single):null,factor=p.page.width/p.page.sourceWidth;
 const fontScale=factor*(style?.scaleY||1)*(single?.sy||1),spacingScale=factor*(style?.scaleX||1)*(single?.sx||1),fill=single?.type==='shape'?shapeFill(single):'';
 const gp=p.guidePage||p.page,guideUpdate=p.updateGuides||p.updatePage,guideOffset=p.guidePage?0:(p.pageOffset||0);
 const [constrain,setConstrain]=useState(true);const edit=(fn:(e:DesignElement)=>DesignElement,record=true)=>p.updatePage(page=>({...page,elements:page.elements.map(e=>e.id===single?.id?fn(e):e)}),record);
 const val=single?visualBox(single):null;const num={begin:p.begin,commit:p.commit};
 const textPatch=(patch:Parameters<typeof changeText>[1])=>edit(e=>changeText(e,patch),false);
 const layerOrder=(dir:number)=>p.orderSelection(dir>0?'up':'down');
 return <aside className="inspector">
  <div className="panel-heading"><h2>{p.selected.length>1?`已选择 ${p.selected.length} 个元素`:single?({text:'文本属性',image:'图片属性',shape:'图形属性',group:'组合属性'}[single.type]):'画布属性'}</h2>{single&&<button className="icon-btn" title={single.locked?'解锁图层':'锁定图层'} aria-label={single.locked?'解锁图层':'锁定图层'} onClick={()=>edit(e=>({...e,locked:!e.locked}))}>{single.locked?<Lock size={16}/>:<Unlock size={16}/>}</button>}</div>
  <div className="inspector-scroll">
   {p.selected.length>0&&<OpacityControl key={p.selected.join('|')} values={p.opacityValues} editableCount={p.opacityEditableCount} onChange={p.changeOpacity} begin={p.begin} commit={p.commit}/>}
   <div className="inspector-section section-size-panel">
    <div className="section-title"><h3>当前分屏</h3><span className="section-size-name" title={p.page.title}>{p.page.title}</span></div>
    <NumberField label="分屏高度" value={p.page.height} min={MIN_SECTION_HEIGHT} max={MAX_SECTION_HEIGHT} unit="px" {...num} onChange={v=>p.resizePage(v,false)}/>
    <div className="action-row"><button aria-label="分屏缩短100像素" disabled={p.page.height<=MIN_SECTION_HEIGHT} onClick={()=>p.resizePage(p.page.height-100)}>−100 px</button><button aria-label="分屏加高100像素" disabled={p.page.height>=MAX_SECTION_HEIGHT} onClick={()=>p.resizePage(p.page.height+100)}>+100 px</button><button onClick={p.showPageBottom}>定位底边</button></div>
    <p className="help-text compact">开启工具栏“调节底边”后可拖动，后续分屏自动顺移。</p>
   </div>
   {!single&&p.selected.length<2&&<div className="inspector-section"><p className="help-text">选择画面或图层中的文字、图片进行编辑。按住 Shift 可多选，也可以在空白处拖动框选。</p><div className="static-property"><span>长画布宽度</span><b>790 px</b></div><div className="static-property"><span>中文字体</span><b>苹方</b></div></div>}
   {single&&<div className="inspector-section">
    <label className="full-field">图层名称<input aria-label="图层名称" value={single.name} onFocus={p.begin} onBlur={p.commit} onChange={e=>edit(x=>({...x,name:e.target.value}),false)}/></label>
    {style&&<>
     <textarea ref={p.textRef} aria-label="文本内容" className="text-content" value={style.content} onFocus={p.begin} onBlur={p.commit} onChange={e=>textPatch({content:e.target.value})} rows={3}/>
     <div className="static-property"><span>字体</span><b>苹方 PingFang SC</b></div>
     <label className="inline-field"><span>字重</span><select aria-label="字重" value={style.weight} onChange={e=>edit(x=>changeText(x,{weight:e.target.value}))}><option value="300">细体 Light</option><option value="400">常规 Regular</option><option value="500">中等 Medium</option><option value="600">中黑 Semibold</option><option value="700">粗体 Bold</option></select></label>
     <div className="fields-grid"><NumberField label="字号" value={style.fontSize*fontScale} min={8} max={300} unit="px" {...num} onChange={v=>textPatch({fontSize:v/fontScale})}/><NumberField label="行高" value={style.lineHeight} min={.7} max={3} step={.1} {...num} onChange={v=>textPatch({lineHeight:v})}/></div>
     <NumberField label="字距" value={style.spacing*spacingScale} min={-10} max={50} unit="px" step={.5} {...num} onChange={v=>textPatch({spacing:v/spacingScale})}/>
     <label className="color-field"><span>文字颜色</span><input aria-label="文字颜色" type="color" value={/^#[0-9a-f]{6}$/i.test(style.color)?style.color:'#001b4d'} onFocus={p.begin} onBlur={p.commit} onChange={e=>textPatch({color:e.target.value})}/><code>{style.color.toUpperCase()}</code></label>
    </>}
    {single.type==='image'&&<button className="wide-btn" onClick={p.replaceImage}><ImageIcon size={16}/>替换图片</button>}
    {single.type==='shape'&&<label className="color-field"><span>图形填充</span><input aria-label="图形填充" type="color" value={/^#[0-9a-f]{6}$/i.test(fill)?fill:'#001b4d'} onFocus={p.begin} onBlur={p.commit} onChange={e=>edit(el=>changeShapeFill(el,e.target.value),false)}/></label>}
   </div>}
   {p.selected.length>1&&p.selectionBox&&p.transformSelection&&<div className="inspector-section"><h3>整体位置与尺寸</h3><div className="fields-grid"><NumberField label="整体 X" value={p.selectionBox.x} {...num} unit="px" onChange={x=>p.transformSelection?.({x})}/><NumberField label="整体 Y" value={p.selectionBox.y} {...num} unit="px" onChange={y=>p.transformSelection?.({y})}/><NumberField label="整体宽度" value={p.selectionBox.width} min={1} {...num} unit="px" onChange={width=>p.transformSelection?.({width})}/><NumberField label="整体高度" value={p.selectionBox.height} min={1} {...num} unit="px" onChange={height=>p.transformSelection?.({height})}/></div><p className="help-text compact">按整体等比缩放，保留各对象的相对位置。</p><div className="action-row"><button onClick={p.duplicate}><Copy size={15}/>复制选中</button><button onClick={p.remove}><Trash2 size={15}/>删除选中</button></div></div>}
   {single&&val&&<div className="inspector-section"><h3>位置与尺寸 {single.locked&&<small>· 已锁定</small>}</h3><fieldset disabled={single.locked}>
    <div className="fields-grid"><NumberField label="X" value={val.x} {...num} unit="px" onChange={v=>edit(e=>({...e,tx:v-e.bbox.x}),false)}/><NumberField label="Y" value={val.y+(p.pageOffset||0)} {...num} unit="px" onChange={v=>edit(e=>({...e,ty:v-(p.pageOffset||0)-e.bbox.y}),false)}/><NumberField label="宽度" value={val.width} min={1} unit="px" {...num} onChange={v=>edit(e=>({...e,sx:v/e.bbox.width,sy:constrain?e.sy*(v/val.width):e.sy}),false)}/><NumberField label="高度" value={val.height} min={1} unit="px" {...num} onChange={v=>edit(e=>({...e,sy:v/e.bbox.height,sx:constrain?e.sx*(v/val.height):e.sx}),false)}/></div>
    <label className="check-row"><input type="checkbox" checked={constrain} onChange={e=>setConstrain(e.target.checked)}/>锁定宽高比例</label>
    </fieldset>
    <div className="action-row"><button title="上移一层" onClick={()=>layerOrder(1)}><ArrowUp size={15}/>上移</button><button title="下移一层" onClick={()=>layerOrder(-1)}><ArrowDown size={15}/>下移</button><button title="复制元素" aria-label="复制元素" onClick={p.duplicate}><Copy size={15}/></button><button title="删除元素" aria-label="删除元素" disabled={single.locked} onClick={p.remove}><Trash2 size={15}/></button></div>
   </div>}
   <div className="inspector-section"><div className="section-title"><h3>对齐与分布</h3><select aria-label="对齐依据" value={p.target} onChange={e=>p.setTarget(e.target.value as 'page'|'selection')}><option value="page">对齐当前分区</option><option value="selection">对齐选区</option></select></div>
    <div className="align-buttons">{alignButtons.map(([mode,Icon,title])=><button key={mode} aria-label={title} title={title} disabled={!p.selected.length} onClick={()=>p.align(mode)}><Icon size={18}/></button>)}</div>
    <div className="action-row"><button disabled={p.selected.length<3} onClick={()=>p.distribute('x')}><ChevronsLeftRight size={16}/>水平等距</button><button disabled={p.selected.length<3} onClick={()=>p.distribute('y')}><ChevronsUpDown size={16}/>垂直等距</button></div>
    <p className="help-text compact">单选相对当前分区；多选可跨分区对齐。等距分布至少选择3个元素。</p>
   </div>
   <div className="inspector-section"><div className="section-title"><h3>参考线</h3><button className="text-btn" disabled={!gp.guides.length} onClick={()=>guideUpdate(q=>({...q,guides:[]}))}>清空</button></div>
    {gp.guides.map(g=><div className="guide-entry" key={g.id}><span>{g.axis==='x'?'垂直':'水平'}</span><NumberField label={`${g.axis==='x'?'垂直':'水平'}参考线位置`} value={g.value+(g.axis==='y'?guideOffset:0)} min={0} max={g.axis==='x'?p.page.width:(p.canvasHeight||p.page.height)} unit="px" {...num} onChange={v=>guideUpdate(q=>({...q,guides:q.guides.map(a=>a.id===g.id?{...a,value:v-(g.axis==='y'?guideOffset:0)}:a)}),false)}/><button className="icon-btn" aria-label={`删除${g.axis==='x'?'垂直':'水平'}参考线`} onClick={()=>guideUpdate(q=>({...q,guides:q.guides.filter(a=>a.id!==g.id)}))}><Trash2 size={14}/></button></div>)}
    <div className="action-row"><button onClick={()=>guideUpdate(q=>({...q,guides:[...q.guides,{id:crypto.randomUUID(),axis:'x',value:q.width/2}]}))}><Plus size={14}/>垂直线</button><button onClick={()=>guideUpdate(q=>({...q,guides:[...q.guides,{id:crypto.randomUUID(),axis:'y',value:Math.round(p.guidePage?(p.pageOffset||0)+p.page.height/2:q.height/2)}]}))}><Plus size={14}/>水平线</button></div>
    <p className="help-text compact">从顶部或左侧标尺拖出参考线。Y坐标从长画布顶部起算，双击线条可删除；参考线不会导出。</p>
   </div>
  </div>
 </aside>;
}
