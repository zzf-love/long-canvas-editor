export interface Box { x:number; y:number; width:number; height:number }
export interface Guide { id:string; axis:'x'|'y'; value:number }
export interface DesignElement {
  id:string; name:string; type:'text'|'image'|'shape'|'group';
  markup:string; bbox:Box; tx:number; ty:number; sx:number; sy:number;
  locked:boolean; hidden:boolean;
  /** Overall layer opacity; omitted keeps the original artwork fully opaque. */
  opacity?:number;
  /** Project-wide association; linked layers remain individually editable. */
  linkId?:string;
}
export interface DesignPage {
  id:string; title:string; width:number; height:number; sourceWidth:number;
  defs:string; elements:DesignElement[]; guides:Guide[];
}
export interface Asset { mime:string; data:string }
export interface Project {
  schemaVersion:1; id:string; title:string; width:790; updatedAt:string;
  pages:DesignPage[]; assets:Record<string,Asset>;
}
export type AlignMode='left'|'centerX'|'right'|'top'|'centerY'|'bottom';
export interface SnapLine { axis:'x'|'y'; value:number }
