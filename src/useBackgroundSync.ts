import {useEffect, useRef, useState, type MutableRefObject} from 'react';
import type {Project} from './types';
import {saveAutosave, hasBackgroundUpdate} from './projectIO';
import {readEditorFile, isPageUpdate} from './pageUpdate';
import {BackgroundUpdateConsumer, BackgroundPersistenceError, holdAutosaveLock, autosaveStatus, type SavedProjectStatus, type BackgroundUpdate} from './backgroundUpdate';
import {ManualBackgroundGate} from './manualBackgroundGate';

interface Options {
  project: Project;
  current: MutableRefObject<Project>;
  apply: (project: Project)=>void;
  isEditing: ()=>boolean;
  onSaveState: (message: string)=>void;
  notify: (message: string)=>void;
}

/** Browser IndexedDB remains authoritative; disk is a mirror, never a replacement seed. */
export function useBackgroundSync(options: Options) {
  const latest = useRef(options);
  latest.current = options;
  const changedAt = useRef(Date.now());
  const savedStatus=useRef<SavedProjectStatus>({project:null,label:''});
  const ownership=useRef<'pending'|'owner'|'blocked'>('pending');
  const manual=useRef(new ManualBackgroundGate(options.project.id));
  const wake=useRef<()=>void>(()=>{});
  const [manualState,setManualState]=useState(()=>manual.current.state);
  const [available,setAvailable]=useState(false);
  const [syncState, setSyncState] = useState('');
  const publishManual=()=>setManualState(previous=>{
    const next=manual.current.state;
    return previous.applying===next.applying&&previous.pendingUpdate?.id===next.pendingUpdate?.id&&previous.pendingUpdate?.title===next.pendingUpdate?.title&&previous.pendingUpdate?.pageId===next.pendingUpdate?.pageId?previous:next;
  });
  useEffect(()=>{
    changedAt.current=Date.now();
    if(manual.current.setProject(options.project.id)){publishManual();setSyncState('');setAvailable(false)}
    options.onSaveState(ownership.current==='blocked'?'本窗口暂停自动保存':autosaveStatus(options.project,savedStatus.current));
  },[options.project]);

  useEffect(()=>{
    let stopped=false, running=false, saved:Project|null=null, mirrored:Project|null=null, ready=false;
    let pointerDown=false, lastError='', retryAt=0;
    let pendingReceipt:{id:string;projectId:string}|null=null;
    let ownsAutosave=false;
    const releaseOwnership=holdAutosaveLock(navigator.locks,owner=>{
      ownsAutosave=owner;
      ownership.current=owner?'owner':'blocked';
      if(!owner){latest.current.onSaveState('本窗口暂停自动保存');setAvailable(false);setSyncState('其他窗口正在编辑；关闭它后刷新本窗口')}
    });
    const local = location.protocol==='http:' && location.hostname==='127.0.0.1';
    const clientId=crypto.randomUUID();
    const request=async(path:string,body?:unknown,method=body===undefined?'GET':'POST')=>{
      const response=await fetch(`/api/${path}`,{method,cache:'no-store',headers:{'X-Long-Canvas-Bridge':'1','X-Long-Canvas-Client':clientId,...(body===undefined?{}:{'Content-Type':'application/json'})},...(body===undefined?{}:{body:JSON.stringify(body)})});
      if(!response.ok){let message='后台协作未连接';try{message=(await response.json()).error||message}catch{}throw new Error(message)}
      return response.json();
    };
    const persist=async(project:Project,receipt?:string)=>{
      if(receipt)pendingReceipt={id:receipt,projectId:project.id};
      const durableReceipt=pendingReceipt?.projectId===project.id?pendingReceipt.id:undefined;
      await saveAutosave(project,durableReceipt);
      if(durableReceipt)pendingReceipt=null;
      saved=project;
      savedStatus.current={project,label:`本机已保存 ${new Date().toLocaleTimeString('zh-CN',{hour:'2-digit',minute:'2-digit'})}`};
      if(!stopped)latest.current.onSaveState(autosaveStatus(latest.current.current.current,savedStatus.current));
    };
    const isEditing=()=>stopped||pointerDown||latest.current.isEditing()||!!document.activeElement?.closest('input,textarea,select,[contenteditable=true]');
    const receipt=async(id:string,projectId:string)=>{
      try{return await hasBackgroundUpdate(id,projectId)}
      catch{throw new BackgroundPersistenceError('无法读取本机更新记录，正在重试；改稿尚未应用。')}
    };
    const consumer=new BackgroundUpdateConsumer({current:()=>latest.current.current.current,hasReceipt:receipt,apply:project=>latest.current.apply(project),persist,isEditing});
    const down=()=>{pointerDown=true};
    const up=()=>{pointerDown=false};
    document.addEventListener('pointerdown',down,true);
    window.addEventListener('pointerup',up,true);
    window.addEventListener('pointercancel',up,true);
    window.addEventListener('blur',up);
    const tick=async()=>{
      if(stopped||running||!ownsAutosave)return;
      running=true;
      try {
        const current=latest.current.current.current;
        if(manual.current.setProject(current.id))publishManual();
        if(saved!==current){
          if(Date.now()-changedAt.current<700)return;
          try{await persist(current)}catch{setAvailable(false);latest.current.onSaveState('本机自动保存不可用，请保存工程');return}
        }
        if(!local||Date.now()<retryAt)return;
        try {
          if(mirrored!==saved){
            const candidate=saved;
            await request('snapshot',candidate,'PUT');
            mirrored=candidate;ready=true;setAvailable(true);setSyncState('文件已同步');lastError='';
          }
          // Mirror/autosave stays automatic; artwork waits for explicit consent to this queued ID.
          if(!ready)return;
          const projectId=latest.current.current.current.id;
          const result=await request(`updates/next?projectId=${encodeURIComponent(projectId)}`);
          if(stopped||latest.current.current.current.id!==projectId)return;
          setAvailable(true);
          manual.current.discover((result.update||null) as BackgroundUpdate|null);
          publishManual();
          if(!result.update){setSyncState('文件已同步');lastError='';return}
          setSyncState(manual.current.state.applying?'正在应用后台改稿…':'有改稿待应用');
          if(isEditing())return;
          try {
            await manual.current.run(async incoming=>{
              try {
                const checked=await readEditorFile(new File([JSON.stringify(incoming.patch)],'background-update.json',{type:'application/json'}));
                if(stopped||latest.current.current.current.id!==projectId)return 'retry';
                if(!isPageUpdate(checked))throw new Error('后台仅接受分屏局部更新。');
                const outcome=await consumer.consume({...incoming,patch:checked});
                if(outcome==='retry')return 'retry';
                await request(`updates/${encodeURIComponent(incoming.id)}/ack`,{state:'applied'});
                // The new project is already in IndexedDB with its receipt; mirror immediately.
                const candidate=latest.current.current.current;
                await request('snapshot',candidate,'PUT');
                mirrored=candidate;
                setSyncState('文件已同步');lastError='';
                if(outcome==='applied')latest.current.notify(`${checked.title}已应用，可撤销`);
                return 'finished';
              } catch(error) {
                const message=error instanceof Error?error.message:'后台更新未完成';
                if(stopped||latest.current.current.current.id!==projectId)return 'retry';
                if(error instanceof BackgroundPersistenceError)throw error;
                // An ACK/network failure after commit is retried via the durable receipt.
                if(await hasBackgroundUpdate(incoming.id,latest.current.current.current.id))throw error;
                await request(`updates/${encodeURIComponent(incoming.id)}/ack`,{state:'rejected',error:message});
                setSyncState('更新需复核');latest.current.notify(message);
                return 'finished';
              }
            });
          } finally {if(!stopped)publishManual()}
        } catch(error) {
          const message=error instanceof Error?error.message:'后台协作未连接';
          setAvailable(false);setSyncState(message);retryAt=Date.now()+5000;
          if(ready&&message!==lastError){latest.current.notify(message);lastError=message}
        }
      } finally {running=false}
    };
    wake.current=()=>void tick();
    const timer=window.setInterval(()=>void tick(),1000);
    return()=>{stopped=true;wake.current=()=>{};releaseOwnership();clearInterval(timer);document.removeEventListener('pointerdown',down,true);window.removeEventListener('pointerup',up,true);window.removeEventListener('pointercancel',up,true);window.removeEventListener('blur',up)};
  },[]);
  const applyPending=()=>{
    // Capture the displayed ID; a click cannot authorize an undiscovered or replacement revision.
    const id=manualState.pendingUpdate?.id;
    if(!available||!id||!manual.current.approve(id))return;
    publishManual();setSyncState('正在应用后台改稿…');wake.current();
  };
  return {syncState,...manualState,applyPending,available};
}
