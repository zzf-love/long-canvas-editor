import type {BackgroundUpdate} from './backgroundUpdate';

export interface PendingBackgroundUpdate {id:string;title:string;pageId:string}
export interface ManualBackgroundState {pendingUpdate:PendingBackgroundUpdate|null;applying:boolean}

/** Consent belongs to one discovered revision, never to a queue or a future revision. */
export class ManualBackgroundGate {
  private pending:BackgroundUpdate|null=null;
  private requestedId:string|null=null;
  private running=false;
  private generation=0;
  constructor(private projectId:string) {}

  setProject(projectId:string):boolean {
    if(this.projectId===projectId)return false;
    this.projectId=projectId;this.pending=null;this.requestedId=null;this.generation++;
    return true;
  }
  discover(update:BackgroundUpdate|null):void {
    const next=update?.patch.targetProjectId===this.projectId?update:null;
    if(next?.id!==this.pending?.id)this.requestedId=null;
    this.pending=next;
  }
  get state():ManualBackgroundState {
    const pendingUpdate=this.pending?{id:this.pending.id,title:this.pending.patch.title,pageId:this.pending.patch.pageId}:null;
    return {pendingUpdate,applying:!!this.pending&&this.requestedId===this.pending.id};
  }
  approve(id:string):boolean {
    if(!this.pending||this.pending.id!==id||this.requestedId===id||this.running)return false;
    this.requestedId=id;
    return true;
  }
  async run(consume:(update:BackgroundUpdate)=>Promise<'retry'|'finished'>):Promise<void> {
    const update=this.pending;
    if(this.running||!update||this.requestedId!==update.id)return;
    const generation=this.generation;
    this.running=true;
    try {
      const outcome=await consume(update);
      // Storage/network failures throw and preserve consent for a retry of this ID only.
      if(outcome==='finished'&&generation===this.generation&&this.pending?.id===update.id){
        this.pending=null;this.requestedId=null;
      }
    } finally {this.running=false}
  }
}
