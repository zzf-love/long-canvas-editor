import type {Project} from './types';
import {applyPageUpdate, type PageUpdate} from './pageUpdate';

export interface BackgroundUpdate {
  id: string;
  expectedPageHash: string;
  patch: PageUpdate;
}

/** Property order is irrelevant; array order (including layer order) is meaningful. */
export function canonicalJSON(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJSON).join(',')}]`;
  if (value && typeof value === 'object') return `{${Object.entries(value).filter(([,v])=>v!==undefined).sort(([a],[b])=>a<b?-1:a>b?1:0).map(([k,v])=>`${JSON.stringify(k)}:${canonicalJSON(v)}`).join(',')}}`;
  return JSON.stringify(value);
}

export async function pageHash(project: Project, pageId: string): Promise<string> {
  const page = project.pages.find(p=>p.id===pageId);
  if (!page) throw new Error('当前工程找不到需要更新的分屏。');
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(canonicalJSON(page)));
  return Array.from(new Uint8Array(digest),v=>v.toString(16).padStart(2,'0')).join('');
}

export interface BackgroundUpdateHost {
  current: ()=>Project;
  hasReceipt: (id: string, projectId: string)=>Promise<boolean>;
  apply: (project: Project)=>void;
  persist: (project: Project, receiptId: string)=>Promise<void>;
  isEditing?: ()=>boolean;
}

export class BackgroundPersistenceError extends Error {}

export interface SavedProjectStatus {project:Project|null;label:string}
export function autosaveStatus(project:Project,saved:SavedProjectStatus):string {
  return project===saved.project?saved.label:'正在保存…';
}

/** Hold the authoritative autosave writer across tabs; a denied tab must reload to take over fresh data. */
export function holdAutosaveLock(locks: Pick<LockManager,'request'>|undefined, onState:(owner:boolean)=>void):()=>void {
  let stopped=false,release:(()=>void)|undefined;
  if(!locks){onState(true);return()=>{}}
  void locks.request('long-canvas-editor-authoritative-autosave',{mode:'exclusive',ifAvailable:true},async lock=>{
    if(stopped)return;
    onState(!!lock);
    if(lock)await new Promise<void>(resolve=>{release=resolve});
  }).catch(()=>{if(!stopped)onState(false)});
  return()=>{stopped=true;release?.()};
}

/** This object survives retries but never enters exported artwork or undo history. */
export class BackgroundUpdateConsumer {
  private applied = new Set<string>();
  constructor(private host: BackgroundUpdateHost) {}
  private async persist(id: string) {
    try { await this.host.persist(this.host.current(), id); }
    catch { throw new BackgroundPersistenceError('后台更新已显示，但本机保存失败，正在重试；请暂勿关闭页面。'); }
  }
  async consume(envelope: BackgroundUpdate): Promise<'applied'|'already-applied'|'retry'> {
    const {id, patch, expectedPageHash} = envelope;
    const before = this.host.current();
    if (before.id !== patch.targetProjectId) throw new Error('后台更新与当前工程不匹配，未应用。');
    if (await this.host.hasReceipt(id, before.id)) return 'already-applied';
    if (this.applied.has(id)) {
      await this.persist(id);
      return 'already-applied';
    }
    const actual = await pageHash(before, patch.pageId);
    // A user edit arrived while hashing/reading storage: leave it alone and check next tick.
    if (this.host.current() !== before || this.host.isEditing?.()) return 'retry';
    if (actual !== expectedPageHash) throw new Error('该分屏在后台取稿后又有修改，更新已暂停，未覆盖手动编辑。');
    const next = applyPageUpdate(before, patch);
    this.host.apply(next);
    this.applied.add(id);
    await this.persist(id);
    return 'applied';
  }
}
