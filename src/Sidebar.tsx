import {useState} from 'react';
import {Type,Image as ImageIcon,Square,Eye,EyeOff,Lock,Unlock,ArrowUp,ArrowDown,Copy,Trash2,Plus} from 'lucide-react';
import type {Project,DesignPage} from './types';
import Artwork from './Artwork';
type Props={project:Project;page:DesignPage;selectPage:(id:string)=>void;selected:string[];setSelected:(ids:string[])=>void;updatePage:(fn:(p:DesignPage)=>DesignPage)=>void;pageAction:(a:'up'|'down'|'copy'|'delete'|'add')=>void};
export default function Sidebar(p:Props){
 const [tab,setTab]=useState<'pages'|'layers'>('pages');
 return <aside className="sidebar"><div className="tabs"><button className={tab==='pages'?'active':''} onClick={()=>setTab('pages')}>分屏</button><button className={tab==='layers'?'active':''} onClick={()=>setTab('layers')}>图层</button></div>
 {tab==='pages'?<>
  <div className="sidebar-meta">全部 {p.project.pages.length} 屏 <button className="icon-btn" title="新增空白屏" aria-label="新增空白屏" onClick={()=>p.pageAction('add')}><Plus size={16}/></button></div>
  <div className="page-list">{p.project.pages.map((page,i)=><button key={page.id} className={`page-item ${page.id===p.page.id?'active':''}`} onClick={()=>p.selectPage(page.id)} aria-label={`第${i+1}屏 ${page.title}`}>
   <div className="page-thumb" style={{height:Math.min(122,page.height*64/page.width)}}><Artwork project={p.project} page={page} style={{width:64,height:page.height*64/page.width}}/></div><div><b>{String(i+1).padStart(2,'0')} {page.title}</b><small>790 × {page.height}</small></div>
  </button>)}</div>
  <div className="sidebar-actions"><button aria-label="分屏上移" title="分屏上移" disabled={p.project.pages[0].id===p.page.id} onClick={()=>p.pageAction('up')}><ArrowUp size={16}/></button><button aria-label="分屏下移" title="分屏下移" disabled={p.project.pages.at(-1)?.id===p.page.id} onClick={()=>p.pageAction('down')}><ArrowDown size={16}/></button><button aria-label="复制分屏" title="复制分屏" onClick={()=>p.pageAction('copy')}><Copy size={16}/></button><button aria-label="删除分屏" title="删除分屏（可撤销）" disabled={p.project.pages.length===1} onClick={()=>p.pageAction('delete')}><Trash2 size={16}/></button></div>
 </>:<>
  <div className="sidebar-meta">当前屏 {p.page.elements.length} 个图层</div>
  <div className="layer-list">{[...p.page.elements].reverse().map(el=>{const Icon=el.type==='text'?Type:el.type==='image'?ImageIcon:Square;return <div key={el.id} className={`layer-item ${p.selected.includes(el.id)?'active':''} ${el.hidden?'muted':''}`}>
   <button className="layer-name" onClick={e=>p.setSelected(e.shiftKey?(p.selected.includes(el.id)?p.selected.filter(x=>x!==el.id):[...p.selected,el.id]):[el.id])}><Icon size={14}/><span>{el.name}</span></button>
   <button className="tiny-btn" aria-label={`${el.hidden?'显示':'隐藏'} ${el.name}`} title={el.hidden?'显示':'隐藏'} onClick={()=>p.updatePage(q=>({...q,elements:q.elements.map(x=>x.id===el.id?{...x,hidden:!x.hidden}:x)}))}>{el.hidden?<EyeOff size={13}/>:<Eye size={13}/>}</button>
   <button className="tiny-btn" aria-label={`${el.locked?'解锁':'锁定'} ${el.name}`} title={el.locked?'解锁':'锁定'} onClick={()=>p.updatePage(q=>({...q,elements:q.elements.map(x=>x.id===el.id?{...x,locked:!x.locked}:x)}))}>{el.locked?<Lock size={13}/>:<Unlock size={13}/>}</button>
  </div>})}</div><p className="sidebar-tip">Shift + 点击多选图层<br/>锁定图层可在这里选中并解锁</p>
 </>}
 </aside>;
}
