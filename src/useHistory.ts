import {useCallback,useRef,useState} from 'react';
import type {Project} from './types';

export function useHistory(initial:Project){
  const [project,setProject]=useState(initial);
  const ref=useRef(initial),past=useRef<Project[]>([]),future=useRef<Project[]>([]),start=useRef<Project|null>(null);
  const [,tick]=useState(0);
  const apply=useCallback((value:Project)=>{ref.current=value;setProject(value);tick(n=>n+1)},[]);
  const update=useCallback((fn:(p:Project)=>Project,record=true)=>{
    const before=ref.current,next=fn(before);if(next===before)return;
    if(record&&!start.current){past.current=[...past.current.slice(-49),before];future.current=[];}
    apply({...next,updatedAt:new Date().toISOString()});
  },[apply]);
  const begin=useCallback(()=>{if(!start.current)start.current=ref.current},[]);
  const commit=useCallback(()=>{if(start.current&&start.current!==ref.current){past.current=[...past.current.slice(-49),start.current];future.current=[];}start.current=null;tick(n=>n+1)},[]);
  const undo=useCallback(()=>{if(start.current)return;const last=past.current.pop();if(last){future.current.push(ref.current);apply(last)}},[apply]);
  const redo=useCallback(()=>{if(start.current)return;const next=future.current.pop();if(next){past.current.push(ref.current);apply(next)}},[apply]);
  const replace=useCallback((p:Project)=>{past.current=[];future.current=[];start.current=null;apply(p)},[apply]);
  return {project,ref,update,begin,commit,undo,redo,replace,isEditing:()=>start.current!==null,canUndo:past.current.length>0,canRedo:future.current.length>0};
}
