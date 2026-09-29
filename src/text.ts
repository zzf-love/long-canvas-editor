import type {DesignElement} from './types';
export const parseElement=(el:DesignElement)=>new DOMParser().parseFromString(`<svg xmlns="http://www.w3.org/2000/svg">${el.markup}</svg>`,'image/svg+xml');
type LinearMatrix=[number,number,number,number];
const multiply=(a:LinearMatrix,b:LinearMatrix):LinearMatrix=>[
  a[0]*b[0]+a[2]*b[1],a[1]*b[0]+a[3]*b[1],
  a[0]*b[2]+a[2]*b[3],a[1]*b[2]+a[3]*b[3],
];
/** Source-width transfers wrap artwork in SVG transforms; typography stays in source units. */
function textTransformScale(node:Element){
  const ancestors:Element[]=[];for(let current:Element|null=node;current;current=current.parentElement)ancestors.unshift(current);
  let matrix:LinearMatrix=[1,0,0,1];
  for(const ancestor of ancestors){
    for(const match of (ancestor.getAttribute('transform')||'').matchAll(/([a-z]+)\s*\(([^)]*)\)/gi)){
      const args=(match[2].match(/[+-]?(?:\d*\.\d+|\d+\.?\d*)(?:e[+-]?\d+)?/gi)||[]).map(Number);
      let next:LinearMatrix=[1,0,0,1];
      switch(match[1].toLowerCase()){
        case 'scale': if(args.length)next=[args[0],0,0,args[1]??args[0]];break;
        case 'matrix': if(args.length>=6)next=[args[0],args[1],args[2],args[3]];break;
        case 'rotate': if(args.length){const a=args[0]*Math.PI/180;next=[Math.cos(a),Math.sin(a),-Math.sin(a),Math.cos(a)]}break;
        case 'skewx': if(args.length)next=[1,0,Math.tan(args[0]*Math.PI/180),1];break;
        case 'skewy': if(args.length)next=[1,Math.tan(args[0]*Math.PI/180),0,1];break;
      }
      if(next.every(Number.isFinite))matrix=multiply(matrix,next);
    }
  }
  const x=Math.hypot(matrix[0],matrix[1]),y=Math.hypot(matrix[2],matrix[3]);
  return {scaleX:x>0?x:1,scaleY:y>0?y:1};
}
export function textStyle(el:DesignElement){
  const root=parseElement(el),t=root.querySelector('text');
  if(!t)return null;
  const spans=Array.from(t.querySelectorAll(':scope > tspan'));
  return {content:spans.length?spans.map(s=>s.textContent||'').join('\n'):t.textContent||'',fontSize:Number(t.getAttribute('font-size')||30),weight:t.getAttribute('font-weight')||'400',color:t.getAttribute('fill')||'#001B4D',spacing:Number(t.getAttribute('letter-spacing')||0),lineHeight:Number(t.getAttribute('data-line-height')||1.3),...textTransformScale(t)};
}
export function changeText(el:DesignElement,patch:Partial<Omit<NonNullable<ReturnType<typeof textStyle>>,'scaleX'|'scaleY'>>):DesignElement{
  const root=parseElement(el),t=root.querySelector('text');if(!t)return el;
  const state={...textStyle(el)!,...patch};
  t.setAttribute('font-family','PingFang SC, sans-serif');t.setAttribute('font-size',String(state.fontSize));t.setAttribute('font-weight',state.weight);t.setAttribute('fill',state.color);t.setAttribute('letter-spacing',String(state.spacing));t.setAttribute('data-line-height',String(state.lineHeight));
  t.replaceChildren();const lines=state.content.split('\n');
  if(lines.length===1)t.textContent=state.content;
  else lines.forEach((line,i)=>{const s=root.createElementNS('http://www.w3.org/2000/svg','tspan');s.setAttribute('x',t.getAttribute('x')||'0');s.setAttribute('dy',i?String(state.fontSize*state.lineHeight):'0');s.textContent=line||' ';t.appendChild(s)});
  return {...el,name:state.content.replace(/\n/g,' ').slice(0,26)||'空文本',markup:new XMLSerializer().serializeToString(root.documentElement.firstElementChild!)};
}
function drawingShape(root:Document):Element|undefined{
  return Array.from(root.querySelectorAll('path,rect,circle,ellipse,polygon,polyline,line,use')).find(node=>
    !node.closest('defs,clipPath,mask,pattern,marker,symbol,filter'));
}
export function shapeFill(el:DesignElement):string{
  const node=drawingShape(parseElement(el));
  if(!node)return '#001b4d';
  const inline=(node as SVGElement).style?.getPropertyValue('fill');
  const fill=inline||node.getAttribute('fill')||'#001b4d';
  const rgb=/^rgb\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*\)$/i.exec(fill);
  if(rgb)return '#'+rgb.slice(1).map(value=>Math.min(255,Number(value)).toString(16).padStart(2,'0')).join('');
  if(/^#[0-9a-f]{3}$/i.test(fill))return '#'+fill.slice(1).split('').map(c=>c+c).join('');
  return fill;
}
/** Apply paint to the actual primitive, preserving all transfer-coordinate wrappers. */
export function changeShapeFill(el:DesignElement,color:string):DesignElement{
  const root=parseElement(el),node=drawingShape(root);if(!node)return el;
  node.setAttribute('fill',color);
  const inline=(node as SVGElement).style;
  if(inline?.getPropertyValue('fill'))inline.setProperty('fill',color);
  return {...el,markup:new XMLSerializer().serializeToString(root.documentElement.firstElementChild!)};
}
export function replaceImageMarkup(el:DesignElement,assetId:string){
  const root=parseElement(el),img=root.querySelector('image');if(!img)return el;
  img.setAttribute('href',`asset:${assetId}`);img.removeAttributeNS('http://www.w3.org/1999/xlink','href');
  return {...el,markup:new XMLSerializer().serializeToString(root.documentElement.firstElementChild!)};
}
