import {useCallback,useEffect,useMemo,useRef,useState} from 'react';
import {FolderOpen,Save,Download,CloudDownload,Undo2,Redo2,Copy,Scissors,ClipboardPaste,Type,Image as ImageIcon,Minus,Plus,ChevronDown,Eye,X,HelpCircle,Check,Loader2} from 'lucide-react';
import type {Project,DesignPage,DesignElement,Box,AlignMode} from './types';
import {useHistory} from './useHistory';
import {unionBoxes,visualBox} from './geometry';
import {alignLinkedElements as alignElements,distributeLinkedElements as distributeElements,selectionUnitCount} from './linkedGeometry';
import {saveProjectFile,loadAutosave,downloadPagePNG,downloadLongPNG,imageFileToAsset,saveBlob} from './projectIO';
import {readEditorFile,isPageUpdate,applyPageUpdate} from './pageUpdate';
import {renderPageSvg} from './svg';
import Canvas from './LongCanvas';
import {applyFlatTransforms,decodeElementKey,elementKey,flattenProject,pageOffsets,relocateElements} from './longLayout';
import Sidebar from './Sidebar';
import LayerPanel from './LayerPanel';
import {expandLinkedSelection,linkElements,unlinkElements,reorderLayers,moveLayerTo} from './layers';
import Inspector,{alignButtons} from './Inspector';
import Artwork from './Artwork';
import {resizeSection} from './sectionResize';
import {useBackgroundSync} from './useBackgroundSync';
import {captureElements,pasteElements,type ElementClipboard} from './elementClipboard';

declare global {interface Window {__LONG_CANVAS_SEED__?:Project}}
const getSeed=async()=>window.__LONG_CANVAS_SEED__||fetch('./seed-project.json').then(r=>{if(!r.ok)throw new Error('无法读取初始草稿');return r.json() as Promise<Project>});
export default function App(){
 const [initial,setInitial]=useState<Project|null>(null),[seed,setSeed]=useState<Project|null>(null),[error,setError]=useState('');
 useEffect(()=>{Promise.all([getSeed(),loadAutosave()]).then(([s,saved])=>{setSeed(s);setInitial(saved?.width===790&&saved.pages.length?saved:s)}).catch(e=>setError(e.message))},[]);
 if(!initial||!seed)return <div className="loading"><div className="brand-mark">L</div><h1>Long Canvas 长图编辑器</h1><p>{error||'正在载入 790px 可编辑草稿…'}</p>{error&&<button onClick={()=>location.reload()}>重新载入</button>}</div>;
 return <Editor initial={initial} seed={seed}/>;
}
function Editor({initial,seed}:{initial:Project;seed:Project}){
 const history=useHistory(initial),{project,update,begin,commit}=history;
 const [pageId,setPageId]=useState(initial.pages[0].id),[selected,setSelectedState]=useState<string[]>([]),[zoom,setZoom]=useState(()=>window.innerHeight>=980?.6:.5),[snap,setSnap]=useState(true),[guides,setGuides]=useState(true),[showSectionResize,setShowSectionResize]=useState(false),[target,setTarget]=useState<'page'|'selection'>('selection');
 const [saveState,setSaveState]=useState('已载入草稿'),[busy,setBusy]=useState(''),[toast,setToast]=useState(''),[exportMenu,setExportMenu]=useState(false),[preview,setPreview]=useState(false),[help,setHelp]=useState(false);
 const fileRef=useRef<HTMLInputElement>(null),imageRef=useRef<HTMLInputElement>(null),imageMode=useRef<'add'|'replace'>('add'),textRef=useRef<HTMLTextAreaElement>(null);
 const clipboard=useRef<{payload:ElementClipboard;count:number;pastes:Map<string,number>}|null>(null);
 const [clipboardCount,setClipboardCount]=useState(0);
 const page=project.pages.find(p=>p.id===pageId)||project.pages[0];
 const flat=useMemo(()=>flattenProject(project),[project.pages]),layout=useMemo(()=>pageOffsets(project),[project.pages]);
 const pageTop=layout.find(x=>x.page.id===page.id)?.top||0;
 const guidePage=useMemo(()=>({...flat,guides:flat.guides.filter((g,i,all)=>g.axis==='y'||all.findIndex(a=>a.axis==='x'&&a.value===g.value)===i)}),[flat]);
 const [jump,setJump]=useState<{id:string;token:number;edge?:'bottom';box?:Box}|null>(null);
 const setSelected=useCallback((keys:string[],direct=false)=>{const next=direct?keys:expandLinkedSelection(history.ref.current,keys);setSelectedState(next);const d=next[0]&&decodeElementKey(next[0]);if(d)setPageId(d.pageId);return next},[history.ref]);
 const localSelected=selected.map(k=>decodeElementKey(k)?.elementId||k);
 const sidebarSelected=selected.map(decodeElementKey).filter(d=>d?.pageId===page.id).map(d=>d!.elementId);
 useEffect(()=>{const next=selected.flatMap(key=>{const d=decodeElementKey(key);if(!d)return [];if(project.pages.find(pg=>pg.id===d.pageId)?.elements.some(e=>e.id===d.elementId))return [key];const owner=project.pages.find(pg=>pg.elements.some(e=>e.id===d.elementId));return owner?[elementKey(owner.id,d.elementId)]:[]});if(next.join('|')!==selected.join('|'))setSelected(next,true)},[project.pages,selected,setSelected]);

 const updatePage=useCallback((fn:(p:DesignPage)=>DesignPage,record=true)=>update(pr=>({...pr,pages:pr.pages.map(pg=>pg.id===page.id?fn(pg):pg)}),record),[page.id,update]);
 const updateGuides=useCallback((fn:(p:DesignPage)=>DesignPage,record=true)=>update(pr=>{const scene=flattenProject(pr);scene.guides=scene.guides.filter((g,i,all)=>g.axis==='y'||all.findIndex(a=>a.axis==='x'&&a.value===g.value)===i);const next=fn(scene);const offsets=pageOffsets(pr);return {...pr,pages:offsets.map(({page:pg,top})=>({...pg,guides:next.guides.flatMap(g=>{const d=decodeElementKey(g.id),owner=d?.pageId||page.id;if(owner!==pg.id)return [];return [{id:d?.elementId||g.id,axis:g.axis,value:g.value-(g.axis==='y'?top:0)}]})}))}},record),[page.id,update]);
 const notify=useCallback((s:string)=>{setToast(s);setTimeout(()=>setToast(''),5500)},[]);
 const run=async(fn:()=>Promise<unknown>|unknown,label:string)=>{if(busy)return;setBusy(label);try{await fn()}catch(e){notify(e instanceof Error?e.message:'操作未完成，请重试')}finally{setBusy('');setExportMenu(false)}};
 const {syncState,pendingUpdate,applying,applyPending,available}=useBackgroundSync({project,current:history.ref,apply:p=>{commit();update(()=>p)},isEditing:()=>!!busy||history.isEditing(),onSaveState:setSaveState,notify});
 const measure=useCallback((boxes:Record<string,Box>)=>{update(pr=>{let changed=false;const pages=pageOffsets(pr).map(({page:pg,top})=>{let pageChanged=false;const elements=pg.elements.map(el=>{const global=boxes[elementKey(pg.id,el.id)];if(!global)return el;const b={...global,y:global.y-top};if(['x','y','width','height'].some(k=>Math.abs(b[k as keyof Box]-el.bbox[k as keyof Box])>.25)){changed=true;pageChanged=true;return {...el,bbox:b}}return el});return pageChanged?{...pg,elements}:pg});return changed?{...pr,pages}:pr},false)},[update]);
 const selectPage=(id:string)=>{commit();setPageId(id);setSelectedState([]);setJump({id,token:Date.now()})};
 const align=(mode:AlignMode)=>update(pr=>{let scene=flattenProject(pr);const count=selectionUnitCount(scene,selected);if(target==='page'||count===1){const shifted={...scene,height:page.height,elements:scene.elements.map(e=>({...e,bbox:{...e.bbox,y:e.bbox.y-pageTop}}))};const aligned=alignElements(shifted,selected,mode,'page');scene={...aligned,height:scene.height,elements:aligned.elements.map(e=>({...e,bbox:{...e.bbox,y:e.bbox.y+pageTop}}))}}else scene=alignElements(scene,selected,mode,'selection');return applyFlatTransforms(pr,scene)});
 const distribute=(axis:'x'|'y')=>update(pr=>applyFlatTransforms(pr,distributeElements(flattenProject(pr),selected,axis)));
 const selectedEditable=flat.elements.filter(e=>selected.includes(e.id)&&!e.locked&&!e.hidden);
 const copySelection=(cut=false,event?:ClipboardEvent)=>{
  if(busy||applying||preview||help)return;
  try{
  const keys=selectedEditable.map(e=>e.id),payload=captureElements(history.ref.current,keys);
  if(!payload){notify('请先选中要复制的可编辑图层');return;}
  clipboard.current={payload,count:keys.length,pastes:new Map()};setClipboardCount(keys.length);
  // Native copy/paste commands (including webview menus) need a clipboard entry.
  // Artwork stays in memory; only a short label is written to the OS clipboard.
  const label=`Long Canvas 图层（${keys.length} 个元素）`;
  if(event?.clipboardData){event.preventDefault();event.clipboardData.setData('text/plain',label);}
  else if(navigator.clipboard?.writeText){void navigator.clipboard.writeText(label).catch(()=>{});}
  if(cut){
   commit();const wanted=new Set(keys);
   update(pr=>({...pr,pages:pr.pages.map(pg=>{const elements=pg.elements.filter(el=>!wanted.has(elementKey(pg.id,el.id)));return elements.length===pg.elements.length?pg:{...pg,elements}})}));
   setSelected([]);
  }
  notify(`已${cut?'剪切':'复制'} ${keys.length} 个元素，选择目标分屏后按 ⌘V 粘贴`);
  }catch(error){notify(error instanceof Error?error.message:'复制未完成，请重试');}
 };
 const pasteSelection=()=>{
  if(busy||applying||preview||help)return;
  try{
  const copied=clipboard.current;if(!copied){notify('请先选中元素并复制，再到目标分屏粘贴');return;}
  commit();const current=history.ref.current,key=JSON.stringify([current.id,page.id]),index=copied.pastes.get(key)??0;
  const result=pasteElements(current,copied.payload,page.id,index);if(result.project===current)return;
  update(()=>result.project);copied.pastes.set(key,index+1);setSelected(result.selected,true);
  const added=flattenProject(result.project).elements.filter(el=>result.selected.includes(el.id));
  if(added.length)setJump({id:page.id,token:Date.now(),box:unionBoxes(added.map(visualBox))});
  notify(`已粘贴 ${result.selected.length} 个元素到「${page.title}」，可直接移动或撤销`);
  }catch(error){notify(error instanceof Error?error.message:'粘贴未完成，请重试');}
 };
 const selectionBox=selectedEditable.length?unionBoxes(selectedEditable.map(visualBox)):undefined;
 const opacityElements=selectedEditable.length?selectedEditable:flat.elements.filter(e=>selected.includes(e.id));
 const changeOpacity=(value:number)=>{if(!Number.isFinite(value))return;const opacity=Math.max(0,Math.min(1,value));update(pr=>{let changed=false;const pages=pr.pages.map(pg=>{let pageChanged=false;const elements=pg.elements.map(el=>{if(!selected.includes(elementKey(pg.id,el.id))||el.locked||el.hidden||(el.opacity??1)===opacity)return el;changed=pageChanged=true;return {...el,opacity}});return pageChanged?{...pg,elements}:pg});return changed?{...pr,pages}:pr},false)};
 const transformSelection=(patch:{x?:number;y?:number;width?:number;height?:number})=>update(pr=>{
  const scene=flattenProject(pr),items=scene.elements.filter(e=>selected.includes(e.id)&&!e.locked&&!e.hidden);if(!items.length)return pr;
  const box=unionBoxes(items.map(visualBox)),scale=patch.width!==undefined?patch.width/Math.max(box.width,1):patch.height!==undefined?patch.height/Math.max(box.height,1):1;
  if(!Number.isFinite(scale)||scale<=0)return pr;
  const x=patch.x??box.x,y=patch.y??box.y;
  return applyFlatTransforms(pr,{...scene,elements:scene.elements.map(e=>{if(!selected.includes(e.id)||e.locked||e.hidden)return e;const b=visualBox(e);return {...e,tx:x+(b.x-box.x)*scale-e.bbox.x,ty:y+(b.y-box.y)*scale-e.bbox.y,sx:e.sx*scale,sy:e.sy*scale}})});
 },false);
 const toggleLayer=(key:string,property:'hidden'|'locked')=>{const d=decodeElementKey(key);if(!d)return;commit();update(pr=>({...pr,pages:pr.pages.map(pg=>pg.id===d.pageId?{...pg,elements:pg.elements.map(e=>e.id===d.elementId?{...e,[property]:!e[property]}:e)}:pg)}))};
 const linkSelection=()=>{commit();const keys=expandLinkedSelection(history.ref.current,selected);update(pr=>linkElements(pr,keys,crypto.randomUUID()));setSelected(keys);notify('对象已链接，点选其中一个可一起移动和缩放')};
 const unlinkSelection=()=>{commit();update(pr=>unlinkElements(pr,selected));notify('已取消链接，对象可分别调整')};
 const orderSelection=(direction:'up'|'down'|'front'|'back')=>{commit();update(pr=>reorderLayers(pr,selected,direction))};
 const reorderSelection=(keys:string[],targetKey:string,placement:'before'|'after')=>{const d=decodeElementKey(targetKey);if(!d)return;const ids=keys.map(decodeElementKey).filter(k=>k?.pageId===d.pageId).map(k=>k!.elementId);commit();update(pr=>moveLayerTo(pr,d.pageId,ids,d.elementId,placement))};
 const remove=()=>{update(pr=>({...pr,pages:pr.pages.map(pg=>({...pg,elements:pg.elements.filter(el=>!selected.includes(elementKey(pg.id,el.id))||el.locked)}))}));setSelected([])};
 const duplicate=()=>{const newIds:string[]=[],links=new Map<string,string>();update(pr=>({...pr,pages:pr.pages.map(pg=>{const copies=pg.elements.filter(e=>selected.includes(elementKey(pg.id,e.id))&&!e.locked&&!e.hidden).map(e=>{const id=crypto.randomUUID();newIds.push(elementKey(pg.id,id));if(e.linkId&&!links.has(e.linkId))links.set(e.linkId,crypto.randomUUID());return {...e,id,linkId:e.linkId?links.get(e.linkId):undefined,name:`${e.name} 副本`,tx:e.tx+16,ty:e.ty+16}});return copies.length?{...pg,elements:[...pg.elements,...copies]}:pg})}));setSelected(newIds)};
 const addText=()=>{const id=crypto.randomUUID(),f=page.width/page.sourceWidth;const el:DesignElement={id,name:'新文字',type:'text',markup:'<text x="70" y="120" font-family="PingFang SC, sans-serif" font-size="40" fill="#001B4D">双击修改文字</text>',bbox:{x:70*f,y:80*f,width:240*f,height:45*f},tx:0,ty:0,sx:1,sy:1,locked:false,hidden:false};updatePage(p=>({...p,elements:[...p.elements,el]}));setSelected([elementKey(page.id,id)]);setTimeout(()=>textRef.current?.focus(),80)};
 const pageAction=(a:'up'|'down'|'copy'|'delete'|'add')=>{let nextId=page.id;update(pr=>{const arr=[...pr.pages],i=arr.findIndex(p=>p.id===page.id);
  if(a==='up'||a==='down'){const j=i+(a==='up'?-1:1);if(j<0||j>=arr.length)return pr;[arr[i],arr[j]]=[arr[j],arr[i]];}
  else if(a==='copy'){const id=crypto.randomUUID(),links=new Map<string,string>();arr.splice(i+1,0,{...page,id,title:`${page.title} 副本`,elements:page.elements.map(el=>{if(el.linkId&&!links.has(el.linkId))links.set(el.linkId,crypto.randomUUID());return {...el,id:crypto.randomUUID(),linkId:el.linkId?links.get(el.linkId):undefined}}),guides:page.guides.map(g=>({...g,id:crypto.randomUUID()}))});nextId=id;}
  else if(a==='delete'){if(arr.length<=1)return pr;arr.splice(i,1);nextId=arr[Math.max(0,i-1)].id;}
  else{const id=crypto.randomUUID();const h=1306;arr.splice(i+1,0,{id,title:'新分屏',width:790,height:h,sourceWidth:790,defs:'',guides:[],elements:[{id:crypto.randomUUID(),name:'背景',type:'shape',markup:`<rect width="790" height="${h}" fill="#FFFFFF"/>`,bbox:{x:0,y:0,width:790,height:h},tx:0,ty:0,sx:1,sy:1,locked:true,hidden:false}]});nextId=id;}
  return {...pr,pages:arr}});setPageId(nextId);setSelectedState([]);setJump({id:nextId,token:Date.now()})};
 const imagePicked=async(file:File)=>{await run(async()=>{const result=await imageFileToAsset(file),{id,asset,width,height}=result;const f=page.width/page.sourceWidth;
  if(imageMode.current==='replace'&&selected.length===1){update(pr=>({...pr,assets:{...pr.assets,[id]:asset},pages:pr.pages.map(pg=>pg.id!==page.id?pg:{...pg,elements:pg.elements.map(el=>el.id!==localSelected[0]?el:{...el,markup:`<image x="${el.bbox.x/f}" y="${el.bbox.y/f}" width="${el.bbox.width/f}" height="${el.bbox.height/f}" href="asset:${id}" preserveAspectRatio="xMidYMid ${el.locked?'slice':'meet'}"/>`,type:'image',name:file.name})})}));}
  else{const eid=crypto.randomUUID(),w=Math.min(380,width),h=w*height/width,x=(790-w)/2,y=160;update(pr=>({...pr,assets:{...pr.assets,[id]:asset},pages:pr.pages.map(pg=>pg.id===page.id?{...pg,elements:[...pg.elements,{id:eid,name:file.name,type:'image',markup:`<image x="${x/f}" y="${y/f}" width="${w/f}" height="${h/f}" href="asset:${id}" preserveAspectRatio="xMidYMid meet"/>`,bbox:{x,y,width:w,height:h},tx:0,ty:0,sx:1,sy:1,hidden:false,locked:false}]}:pg)}));setSelected([elementKey(page.id,eid)]);}
 },'正在读取图片…')};
 const chooseImage=(mode:'add'|'replace')=>{imageMode.current=mode;imageRef.current?.click()};
 const save=()=>run(async()=>{await saveProjectFile(history.ref.current);notify('工程已下载，包含排版和全部素材，可再次打开编辑。')},'正在保存工程…');
 useEffect(()=>{
  const handler=(e:KeyboardEvent)=>{const input=e.target instanceof Element&&e.target.closest('input,textarea,select,[contenteditable]:not([contenteditable="false"])');
   if((e.metaKey||e.ctrlKey)&&e.key.toLowerCase()==='s'){e.preventDefault();save();return;}
   if(input)return;
   if((e.metaKey||e.ctrlKey)&&!e.altKey&&!e.isComposing&&['c','x','v'].includes(e.key.toLowerCase())&&!preview&&!help){e.preventDefault();if(e.repeat)return;e.key.toLowerCase()==='v'?pasteSelection():copySelection(e.key.toLowerCase()==='x');return;}
   if((e.metaKey||e.ctrlKey)&&e.key.toLowerCase()==='z'){e.preventDefault();e.shiftKey?history.redo():history.undo();return;}
   if((e.metaKey||e.ctrlKey)&&e.key.toLowerCase()==='d'){e.preventDefault();duplicate();return;}
   if((e.metaKey||e.ctrlKey)&&e.key.toLowerCase()==='a'){e.preventDefault();setSelected(page.elements.filter(el=>!el.locked&&!el.hidden).map(e=>elementKey(page.id,e.id)));return;}
   if(e.key==='Escape'){setSelected([]);setPreview(false);setHelp(false);setExportMenu(false);return;}
   if(e.key==='Backspace'||e.key==='Delete'){if(selected.length){e.preventDefault();remove();}return;}
   if(['ArrowUp','ArrowDown','ArrowLeft','ArrowRight'].includes(e.key)&&selected.length){e.preventDefault();const step=e.shiftKey?10:1;update(pr=>relocateElements(pr,selected,e.key==='ArrowLeft'?-step:e.key==='ArrowRight'?step:0,e.key==='ArrowUp'?-step:e.key==='ArrowDown'?step:0,false));}

  };
  const nativeClipboard=(e:ClipboardEvent)=>{
   if(busy||applying||preview||help||e.target instanceof Element&&e.target.closest('input,textarea,select,[contenteditable]:not([contenteditable="false"])'))return;
   if(e.type==='paste'){if(clipboard.current){e.preventDefault();pasteSelection();}}
   else if(selectedEditable.length)copySelection(e.type==='cut',e);
  };
  window.addEventListener('keydown',handler);
  for(const type of ['copy','cut','paste'] as const)window.addEventListener(type,nativeClipboard);
  return()=>{window.removeEventListener('keydown',handler);for(const type of ['copy','cut','paste'] as const)window.removeEventListener(type,nativeClipboard)};
 },[project,selected,busy,page.id,applying,preview,help,clipboardCount]);
 const setZ=(v:number)=>setZoom(Math.min(1.5,Math.max(.2,Math.round(v*100)/100)));
 return <div className="app-shell">
  <header className="app-header"><div className="brand"><div className="brand-mark">L</div><div><h1>Long Canvas <span>长图编辑器</span></h1><small>790px · 本地编辑</small></div></div><div className="save-state" title={syncState||undefined}><span className="status-dot"/>{busy||saveState}{syncState&&<small className="background-sync-state"> · {syncState}</small>}</div><div className="header-actions"><button aria-label="应用最新改稿" className={`apply-revision-button${pendingUpdate?" has-update":""}`} disabled={!!busy||applying||!pendingUpdate||!available} aria-busy={applying} title={pendingUpdate?`${pendingUpdate.title} · 点击应用，支持撤销`:"暂无待应用改稿；你的手动修改继续自动保存"} onClick={applyPending}>{applying?<Loader2 size={16} className="spin"/>:<CloudDownload size={16}/>}<span>{applying?"正在应用…":"应用最新改稿"}</span>{pendingUpdate&&!applying&&<span className="revision-dot" aria-label="有新改稿"/>}</button><button aria-label="打开工程" onClick={()=>fileRef.current?.click()} disabled={!!busy}><FolderOpen size={16}/><span>打开工程</span></button><button aria-label="保存工程" onClick={save} disabled={!!busy}><Save size={16}/><span>保存工程</span></button><div className="export-wrapper"><button aria-label="导出图片" className="primary" onClick={()=>setExportMenu(!exportMenu)} disabled={!!busy}><Download size={16}/><span>导出图片</span><ChevronDown size={13}/></button>{exportMenu&&<><button className="menu-backdrop" aria-label="关闭导出菜单" onClick={()=>setExportMenu(false)}/><div className="dropdown"><button onClick={()=>run(()=>downloadPagePNG(project,page),'正在导出当前屏…')}>当前屏 PNG <small>790 × {page.height}</small></button><button onClick={()=>run(()=>downloadLongPNG(project,(...args:unknown[])=>setBusy(`正在导出长图 ${args.filter(x=>typeof x==='number').join(' / ')}…`)),'正在导出长图…')}>完整长图 PNG <small>{project.pages.length} 屏</small></button><button onClick={()=>run(()=>saveBlob(new Blob([renderPageSvg(project,page)],{type:'image/svg+xml'}),`${page.title}-790.svg`),'正在导出SVG…')}>当前屏 SVG <small>保留文字和图形</small></button></div></>}</div></div></header>
  <div className="toolbar"><div className="tool-group"><button aria-label="撤销" title="撤销 ⌘Z" disabled={!history.canUndo} onClick={history.undo}><Undo2 size={18}/></button><button aria-label="重做" title="重做 ⇧⌘Z" disabled={!history.canRedo} onClick={history.redo}><Redo2 size={18}/></button></div><div className="tool-group"><button onClick={addText}><Type size={18}/><span>文字</span></button><button onClick={()=>chooseImage('add')}><ImageIcon size={18}/><span>图片</span></button></div><div className="tool-group clipboard-tools" role="group" aria-label="复制与粘贴"><button aria-label="复制元素" title="复制选中元素 ⌘C / Ctrl+C" disabled={!selectedEditable.length||!!busy||applying} onClick={()=>copySelection()}><Copy size={17}/></button><button aria-label="剪切元素" title="剪切选中元素 ⌘X / Ctrl+X" disabled={!selectedEditable.length||!!busy||applying} onClick={()=>copySelection(true)}><Scissors size={17}/></button><button aria-label="粘贴元素" title={clipboardCount?`粘贴 ${clipboardCount} 个元素到当前分屏 ⌘V / Ctrl+V`:"先选中元素并复制，再切换目标分屏粘贴"} disabled={!clipboardCount||!!busy||applying} onClick={pasteSelection}><ClipboardPaste size={17}/></button></div><div className="tool-group toolbar-align">{alignButtons.map(([mode,Icon,title])=><button key={mode} aria-label={`工具栏${title}`} title={title} disabled={!selected.length} onClick={()=>align(mode)}><Icon size={17}/></button>)}</div><div className="tool-group toggle-group"><label><input type="checkbox" checked={guides} onChange={e=>setGuides(e.target.checked)}/><span>参考线</span></label><label><input type="checkbox" checked={snap} onChange={e=>setSnap(e.target.checked)}/><span>吸附</span></label><label><input type="checkbox" checked={showSectionResize} onChange={e=>setShowSectionResize(e.target.checked)}/><span>调节底边</span></label></div><div className="toolbar-spacer"/><button aria-label="整页预览" className="preview-btn" onClick={()=>setPreview(true)}><Eye size={16}/><span>整页预览</span></button><div className="zoom-control"><button aria-label="缩小" onClick={()=>setZ(zoom-.1)}><Minus size={15}/></button><select aria-label="缩放比例" value={Math.round(zoom*100)} onChange={e=>setZ(Number(e.target.value)/100)}>{[...new Set([20,30,40,50,60,70,80,90,100,125,150,Math.round(zoom*100)])].sort((a,b)=>a-b).map(z=><option key={z} value={z}>{z}%</option>)}</select><button aria-label="放大" onClick={()=>setZ(zoom+.1)}><Plus size={15}/></button></div><button className="icon-btn" aria-label="操作帮助" title="操作帮助" onClick={()=>setHelp(true)}><HelpCircle size={18}/></button></div>
  <div className="editor-body"><Sidebar project={project} page={page} selectPage={selectPage} selected={sidebarSelected} setSelected={ids=>setSelected(ids.map(id=>elementKey(page.id,id)))} updatePage={updatePage} pageAction={pageAction}/><Canvas project={project} page={page} flat={flat} selected={selected} setSelected={setSelected} setActivePage={setPageId} jump={jump} zoom={zoom} snap={snap} showGuides={guides} showSectionResize={showSectionResize} updateProject={update} begin={begin} commit={commit} onMeasure={measure} editText={()=>{if(page.elements.find(e=>e.id===localSelected[0])?.type==='text'){textRef.current?.focus();textRef.current?.select()}}}/><div className="right-panels"><LayerPanel project={project} page={page} selected={selected} onSelect={setSelected} onToggleHidden={key=>toggleLayer(key,'hidden')} onToggleLocked={key=>toggleLayer(key,'locked')} onLink={linkSelection} onUnlink={unlinkSelection} onOrder={orderSelection} onReorder={reorderSelection}/><Inspector opacityValues={opacityElements.map(e=>e.opacity??1)} opacityEditableCount={selectedEditable.length} changeOpacity={changeOpacity} orderSelection={orderSelection} selectionBox={selectionBox} transformSelection={transformSelection} page={page} resizePage={(height,record=true)=>update(pr=>resizeSection(pr,page.id,height),record)} showPageBottom={()=>{setShowSectionResize(true);setJump({id:page.id,token:Date.now(),edge:'bottom'})}} guidePage={guidePage} updateGuides={updateGuides} pageOffset={pageTop} canvasHeight={flat.height} selected={localSelected} updatePage={updatePage} begin={begin} commit={commit} align={align} target={target} setTarget={setTarget} distribute={distribute} duplicate={duplicate} remove={remove} replaceImage={()=>chooseImage('replace')} textRef={textRef}/></div></div>
  <footer className="status-bar"><span>长画布 790 × {flat.height} px</span><span>{selected.length?`已选择 ${selected.length} 个元素`:'连续编辑 · 拖动可跨分区 · Shift 多选'}</span><span>方向键移动 1px · Shift 10px · Alt 暂停吸附</span></footer>
  <input ref={fileRef} type="file" accept=".json,.long-canvas" hidden onChange={e=>{const f=e.target.files?.[0];if(f)run(async()=>{const loaded=await readEditorFile(f);commit();if(isPageUpdate(loaded)){update(pr=>applyPageUpdate(pr,loaded));setPageId(loaded.pageId);setSelected([]);setJump({id:loaded.pageId,token:Date.now()});notify(`${loaded.title}已应用，可撤销`)}else{update(()=>loaded);setPageId(loaded.pages[0].id);setSelected([]);setJump({id:loaded.pages[0].id,token:Date.now()});notify('工程已打开')}},'正在打开工程…');e.target.value=''}}/>
  <input ref={imageRef} type="file" accept="image/png,image/jpeg,image/webp" hidden onChange={e=>{const f=e.target.files?.[0];if(f)imagePicked(f);e.target.value=''}}/>
  {toast&&<div className="toast" role="status"><Check size={17}/>{toast}<button aria-label="关闭提示" onClick={()=>setToast('')}><X size={15}/></button></div>}
  {busy&&<div className="busy-pill"><Loader2 size={16} className="spin"/>{busy}</div>}
  {preview&&<div className="modal-backdrop preview-modal"><div className="modal-top"><b>整页预览 · 790px</b><button onClick={()=>setPreview(false)} aria-label="关闭整页预览"><X size={20}/></button></div><div className="preview-scroll"><div className="preview-pages"><Artwork project={project} page={flat} style={{display:'block',width:'100%',height:'auto'}}/></div></div></div>}
  {help&&<div className="modal-backdrop"><div className="help-modal"><div className="modal-top"><h2>编辑器使用方式</h2><button aria-label="关闭帮助" onClick={()=>setHelp(false)}><X size={20}/></button></div><p>中间是连续长画布，左侧分屏用于快速定位。点选画面后在右侧修改；双击文字可编辑。</p><ul><li>后台改稿准备好后，顶部“应用最新改稿”亮起；点击后才更新画布，可以撤销。手动修改照常自动保存；若同一屏已被你改动，会保留你的版本并提示复核。</li><li>右侧图层面板可搜索和点选小元素。Shift / ⌘ 多选后点击“链接”；之后点选任一链接对象，一起移动或缩放。Alt + 点击图层可单独微调，取消链接可拆开。</li><li>选中图层后，右侧“不透明度”可用滑杆或输入百分比调整。100%保持原效果，0%完全透明；多选时同时设置。支持撤销、保存和导出。</li><li>图层列表上方在前；拖动图层行或使用上移、下移、置顶、置底调整前后遮挡。眼睛控制显示，锁控制编辑；面板可折叠。</li><li>文字和图片可跨分区拖动；靠近视窗上下边缘会自动滚动。画面与导出均保留跨分区内容。</li><li>勾选工具栏“调节底边”或点击“定位底边”后，拖动蓝色底边可调整高度；取消勾选可隐藏底边。右侧可精确输入或增减100px。后续分屏自动顺移，文字与产品图保持原尺寸，支持撤销。</li><li>标尺、Y坐标和水平参考线使用整张长画布坐标。左侧分屏与当前图层归属同步。</li><li>从顶部标尺拖出水平参考线；从左侧拖出垂直参考线。</li><li>双击参考线，或将它拖出画布，即可删除；右侧可输入准确位置。</li><li>Shift + 点击多选，空白处拖动框选。对齐可选择当前分区或选区，3个以上元素可等距分布。</li><li>拖动时吸附到画布、参考线和其他元素。按住Alt暂时关闭吸附。</li><li>右下角方块等比缩放；精确宽高在右侧输入。锁定的背景需在图层中解锁后移动。</li><li>选中元素按⌘C复制，点击左侧目标分屏后按⌘V粘贴；⌘X剪切，也可用工具栏按钮。同一分屏重复粘贴会略微错开；粘贴后自动选中，原有样式、透明度和内部链接保留，副本与原对象独立。支持撤销。</li><li>元素剪贴板用于本次打开编辑器内的分屏复用；刷新后需重新复制。输入框内的复制粘贴仍是正常文字操作。</li><li>⌘S保存完整工程；⌘Z撤销，⇧⌘Z重做；⌘D原屏生成副本。Windows使用Ctrl。</li><li>导出的790px图片不含选框、标尺和参考线。中文优先使用本机苹方，无该字体时使用系统字体。</li></ul><p className="help-note">本机自动保存用于恢复当前工作；跨设备和长期存档请使用“保存工程”。工程包含全部图片素材。</p><button className="wide-btn" onClick={()=>{update(()=>seed);setPageId(seed.pages[0].id);setSelected([]);setJump({id:seed.pages[0].id,token:Date.now()});setHelp(false);notify('已恢复示例工程，可撤销')}}>恢复示例工程（可撤销）</button><button className="primary wide-btn" onClick={()=>setHelp(false)}>开始编辑</button></div></div>}
 </div>;
}
