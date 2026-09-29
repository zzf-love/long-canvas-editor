import type { Asset, Box, DesignElement, DesignPage, Guide, Project } from './types';
import { renderPageSvg, SVG_FONT } from './svg';

const MIB = 1024 * 1024;
export const MAX_PROJECT_BYTES = 128 * MIB;
export const MAX_IMAGE_BYTES = 20 * MIB;
export const MAX_CANVAS_DIMENSION = 32760;
export const MAX_CANVAS_PIXELS = 32_000_000;
const MAX_ASSET_BYTES = 80 * MIB;
const MAX_PAGES = 100;
const SVG_NS = 'http://www.w3.org/2000/svg';
const MIME_TYPES = new Set(['image/png', 'image/jpeg', 'image/webp']);
const SAFE_ID = /^[A-Za-z0-9_.:-]{1,128}$/;
const SVG_TAGS = new Set(['svg', 'g', 'defs', 'rect', 'circle', 'ellipse', 'line', 'polyline', 'polygon', 'path', 'text', 'tspan', 'textPath', 'image', 'use', 'symbol', 'clipPath', 'mask', 'linearGradient', 'radialGradient', 'stop', 'pattern', 'marker', 'filter', 'feBlend', 'feColorMatrix', 'feComponentTransfer', 'feComposite', 'feConvolveMatrix', 'feDiffuseLighting', 'feDisplacementMap', 'feDistantLight', 'feDropShadow', 'feFlood', 'feFuncA', 'feFuncB', 'feFuncG', 'feFuncR', 'feGaussianBlur', 'feMerge', 'feMergeNode', 'feMorphology', 'feOffset', 'fePointLight', 'feSpecularLighting', 'feSpotLight', 'feTile', 'feTurbulence', 'title', 'desc']);
const SVG_ATTRIBUTES = new Set(('id x y x1 y1 x2 y2 cx cy r rx ry width height viewbox preserveaspectratio transform d points fill fill-opacity fill-rule stroke stroke-width stroke-opacity stroke-linecap stroke-linejoin stroke-miterlimit stroke-dasharray stroke-dashoffset opacity color font-family font-size font-style font-weight letter-spacing word-spacing text-anchor dominant-baseline alignment-baseline baseline-shift dx dy rotate textlength lengthadjust clip-path clip-rule mask filter vector-effect paint-order visibility display gradientunits gradienttransform spreadmethod offset stop-color stop-opacity fx fy fr patternunits patterncontentunits patterntransform clippathunits maskunits maskcontentunits markerwidth markerheight markerunits refx refy orient marker-start marker-mid marker-end filterunits primitiveunits in in2 result stddeviation operator k1 k2 k3 k4 mode type values slope intercept amplitude exponent tablevalues flood-color flood-opacity lighting-color surfaceScale diffuseConstant specularConstant specularExponent limitingConeAngle azimuth elevation pointsAtX pointsAtY pointsAtZ z scale xchannelselector ychannelselector basefrequency numoctaves seed stitchtiles radius order kernelmatrix divisor bias targetx targety edgemode kernelunitlength preservealpha startoffset method spacing overflow').toLowerCase().split(/\s+/));
const STYLE_PROPERTIES = new Set('fill fill-opacity fill-rule stroke stroke-opacity stroke-width stroke-linecap stroke-linejoin stroke-miterlimit stroke-dasharray stroke-dashoffset opacity color font-family font-size font-style font-weight letter-spacing word-spacing text-anchor dominant-baseline alignment-baseline paint-order filter clip-path mask vector-effect visibility display mix-blend-mode isolation'.split(' '));

function fail(message: string): never { throw new Error(message); }
function record(value: unknown, name: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) fail(`${name}格式不正确。`);
  return value as Record<string, unknown>;
}
function text(value: unknown, name: string, max = 200): string {
  if (typeof value !== 'string' || value.length > max) fail(`${name}缺失或过长。`);
  return value;
}
function id(value: unknown, name: string): string {
  const result = text(value, name, 128);
  // Editor IDs are metadata (the seed uses page-01/el-01), not literal SVG IDs.
  if (!result.trim() || /[\u0000-\u001f\u007f]/.test(result)) fail(`${name}包含不支持的字符。`);
  return result;
}
function finite(value: unknown, name: string, min = -1_000_000, max = 1_000_000): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < min || value > max) fail(`${name}超出可用范围。`);
  return value;
}
function boolean(value: unknown, name: string): boolean {
  if (typeof value !== 'boolean') fail(`${name}格式不正确。`);
  return value;
}
function list(value: unknown, name: string, max: number): unknown[] {
  if (!Array.isArray(value) || value.length > max) fail(`${name}缺失或数量过多。`);
  return value;
}

function base64ByteLength(data: string): number {
  return data.length / 4 * 3 - (data.endsWith('==') ? 2 : data.endsWith('=') ? 1 : 0);
}
function imageMime(bytes: Uint8Array): string | null {
  if (bytes.length >= 8 && [137, 80, 78, 71, 13, 10, 26, 10].every((byte, i) => bytes[i] === byte)) return 'image/png';
  if (bytes.length >= 3 && bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255) return 'image/jpeg';
  if (bytes.length >= 12 && String.fromCharCode(...bytes.slice(0, 4)) === 'RIFF' && String.fromCharCode(...bytes.slice(8, 12)) === 'WEBP') return 'image/webp';
  return null;
}
function checkAsset(value: unknown, name: string): Asset {
  const asset = record(value, name);
  const mime = text(asset.mime, `${name}类型`, 32);
  const data = text(asset.data, `${name}数据`, Math.ceil(MAX_IMAGE_BYTES / 3) * 4 + 4);
  if (!MIME_TYPES.has(mime) || !data || data.length % 4 !== 0 || !/^[A-Za-z0-9+/]+={0,2}$/.test(data)) fail(`${name}不是有效的PNG、JPEG或WebP素材。`);
  if (base64ByteLength(data) > MAX_IMAGE_BYTES) fail('单张图片不能超过20 MB。');
  const header = atob(data.slice(0, Math.min(32, data.length)));
  if (imageMime(Uint8Array.from(header, c => c.charCodeAt(0))) !== mime) fail(`${name}的图片类型与内容不一致。`);
  return { mime, data };
}

function safePaint(value: string): boolean {
  if (/[\\@]|\/\*|\*\/|[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(value)) return false;
  if (/expression\s*\(|javascript\s*:|vbscript\s*:|https?\s*:|file\s*:|data\s*:|blob\s*:/i.test(value)) return false;
  let valid = true;
  const stripped = value.replace(/url\(\s*(["']?)#([A-Za-z0-9_.:-]+)\1\s*\)/gi, '');
  if (/url\s*\(/i.test(stripped)) valid = false;
  return valid;
}
function sanitizeStyle(style: string): string {
  return style.split(';').map(part => {
    const colon = part.indexOf(':');
    if (colon < 0) return '';
    const key = part.slice(0, colon).trim().toLowerCase();
    const value = part.slice(colon + 1).trim();
    if (!STYLE_PROPERTIES.has(key) || !safePaint(value)) return '';
    return `${key}:${key === 'font-family' ? SVG_FONT : value}`;
  }).filter(Boolean).join(';');
}

/** Only SVG drawing primitives survive import; no active content, external resources or CSS imports. */
export function sanitizeSvgMarkup(markup: string, assets: Record<string, Asset>): string {
  if (/<!DOCTYPE|<!ENTITY/i.test(markup)) fail('SVG中不能包含文档类型或实体声明。');
  if (typeof DOMParser === 'undefined') fail('当前环境不支持SVG项目导入，请在浏览器中打开编辑器。');
  const parsed = new DOMParser().parseFromString(`<svg xmlns="${SVG_NS}" xmlns:xlink="http://www.w3.org/1999/xlink">${markup}</svg>`, 'image/svg+xml');
  if (parsed.getElementsByTagName('parsererror').length) fail('项目中有无法读取的SVG片段。');
  let nodes = 0;
  const clean = (parent: Element): void => {
    for (const node of Array.from(parent.childNodes)) {
      if (node.nodeType === 3 || node.nodeType === 4) continue;
      if (node.nodeType !== 1) { node.remove(); continue; }
      const element = node as Element;
      if (++nodes > 20_000) fail('单个SVG片段过于复杂。');
      if (element.namespaceURI !== SVG_NS || !SVG_TAGS.has(element.localName)) { element.remove(); continue; }
      for (const attribute of Array.from(element.attributes)) {
        const name = attribute.name.toLowerCase();
        const local = attribute.localName.toLowerCase();
        const value = attribute.value.trim();
        if (name.startsWith('on') || name === 'xml:base') { element.removeAttributeNode(attribute); continue; }
        if (local === 'href') {
          let safe = false;
          if (element.localName === 'image') {
            if (/^asset:[A-Za-z0-9_.:-]{1,128}$/.test(value)) {
              if (!Object.prototype.hasOwnProperty.call(assets, value.slice(6))) fail(`找不到图片素材「${value.slice(6)}」。`);
              safe = true;
            } else {
              const match = /^data:(image\/(?:png|jpeg|webp));base64,([A-Za-z0-9+/]+={0,2})$/.exec(value);
              if (match) { checkAsset({ mime: match[1], data: match[2] }, '内嵌图片'); safe = true; }
            }
          } else if (element.localName === 'use' || element.localName === 'textPath') {
            safe = /^#[A-Za-z0-9_.:-]+$/.test(value);
          }
          if (!safe) element.removeAttributeNode(attribute);
          continue;
        }
        if (name === 'style') {
          const style = sanitizeStyle(value);
          if (style) element.setAttribute('style', style); else element.removeAttributeNode(attribute);
          continue;
        }
        if (name === 'data-line-height' && !attribute.namespaceURI && element.localName === 'text') {
          const lineHeight = Number(value);
          if (/^(?:\d+(?:\.\d*)?|\.\d+)$/.test(value) && lineHeight >= 0.7 && lineHeight <= 3) {
            element.setAttribute('data-line-height', String(lineHeight));
          } else {
            element.removeAttributeNode(attribute);
          }
          continue;
        }
        if (name === 'xml:space' && (value === 'preserve' || value === 'default')) continue;
        if (attribute.namespaceURI || !SVG_ATTRIBUTES.has(name) || !safePaint(value)) { element.removeAttributeNode(attribute); continue; }
        if (name === 'font-family') element.setAttribute('font-family', SVG_FONT);
      }
      clean(element);
    }
  };
  clean(parsed.documentElement);
  const serializer = new XMLSerializer();
  return Array.from(parsed.documentElement.childNodes).map(node => serializer.serializeToString(node)).join('');
}

/** Reconstruct from known fields instead of retaining arbitrary properties from imported JSON. */
export function validateProject(value: unknown): Project {
  const input = record(value, '项目');
  if (input.schemaVersion !== 1) fail('项目版本不受支持，请选择本编辑器保存的项目文件。');
  if (input.width !== 790) fail('项目宽度必须为790像素。');
  const serialized = JSON.stringify(value);
  if (serialized.length > MAX_PROJECT_BYTES || new Blob([serialized]).size > MAX_PROJECT_BYTES) fail('项目过大，最大支持128 MB。');
  const assetsInput = record(input.assets, '素材库');
  if (Object.keys(assetsInput).length > 256) fail('图片素材过多，最多支持256张。');
  const assets: Record<string, Asset> = Object.create(null);
  let assetBytes = 0;
  for (const [key, value] of Object.entries(assetsInput)) {
    if (!SAFE_ID.test(key)) fail('素材标识包含不支持的字符。');
    assets[key] = checkAsset(value, `素材${key}`);
    assetBytes += base64ByteLength(assets[key].data);
    if (assetBytes > MAX_ASSET_BYTES) fail('素材总大小不能超过80 MB，请先压缩图片。');
  }
  const pageInput = list(input.pages, '页面', MAX_PAGES);
  if (pageInput.length === 0) fail('项目至少需要一页。');
  const pageIds = new Set<string>();
  let elementCount = 0;
  const pages: DesignPage[] = pageInput.map((raw, pageIndex) => {
    const p = record(raw, `第${pageIndex + 1}页`);
    const pageId = id(p.id, '页面标识');
    if (pageIds.has(pageId)) fail('页面标识重复。');
    pageIds.add(pageId);
    if (p.width !== 790) fail(`第${pageIndex + 1}页的宽度必须为790像素。`);
    const elementIds = new Set<string>();
    const elements: DesignElement[] = list(p.elements, '页面元素', 3000).map(raw => {
      if (++elementCount > 30_000) fail('项目元素过多，最多支持30000个。');
      const e = record(raw, '元素');
      const elementId = id(e.id, '元素标识');
      if (elementIds.has(elementId)) fail('同一页面内的元素标识不能重复。');
      elementIds.add(elementId);
      if (!['text', 'image', 'shape', 'group'].includes(String(e.type))) fail('元素类型无效。');
      const linkId = e.linkId === undefined ? undefined : id(e.linkId, '图层链接标识');
      const opacity = e.opacity === undefined ? undefined : finite(e.opacity, '图层不透明度', 0, 1);
      const b = record(e.bbox, '元素边界');
      const bbox: Box = { x: finite(b.x, '元素横坐标'), y: finite(b.y, '元素纵坐标'), width: finite(b.width, '元素宽度', 0), height: finite(b.height, '元素高度', 0) };
      return {
        id: elementId, name: text(e.name, '元素名称'), type: e.type as DesignElement['type'],
        markup: sanitizeSvgMarkup(text(e.markup, '元素SVG', 30 * MIB), assets), bbox,
        tx: finite(e.tx, '横向偏移'), ty: finite(e.ty, '纵向偏移'), sx: finite(e.sx, '横向缩放', 0.001, 1000), sy: finite(e.sy, '纵向缩放', 0.001, 1000),
        locked: boolean(e.locked, '锁定状态'), hidden: boolean(e.hidden, '隐藏状态'),
        ...(linkId === undefined ? {} : { linkId }),
        ...(opacity === undefined ? {} : { opacity }),
      };
    });
    const guides: Guide[] = list(p.guides, '参考线', 200).map(raw => {
      const g = record(raw, '参考线');
      if (g.axis !== 'x' && g.axis !== 'y') fail('参考线方向无效。');
      return { id: id(g.id, '参考线标识'), axis: g.axis, value: finite(g.value, '参考线位置') };
    });
    return { id: pageId, title: text(p.title, '页面名称'), width: 790, height: finite(p.height, '页面高度', 1, 16_384), sourceWidth: finite(p.sourceWidth, '原稿宽度', 1, 16_384), defs: sanitizeSvgMarkup(text(p.defs, 'SVG定义', 2 * MIB), assets), elements, guides };
  });
  const updatedAt = text(input.updatedAt, '保存日期', 100);
  if (!Number.isFinite(Date.parse(updatedAt))) fail('项目保存日期无效。');
  return { schemaVersion: 1, id: id(input.id, '项目标识'), title: text(input.title, '项目名称'), width: 790, updatedAt, pages, assets };
}

function filename(value: string): string {
  return (value.replace(/[<>:"/\\|?*\u0000-\u001f]/g, '-').replace(/[. ]+$/g, '').trim() || 'Long Canvas').slice(0, 100);
}

export function saveBlob(blob: Blob, name: string): void {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = name;
  anchor.style.display = 'none';
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  // Keep the URL alive until browsers have started reading the download.
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}

export function saveProjectFile(project: Project): void {
  const saved = validateProject({ ...project, updatedAt: new Date().toISOString() });
  saveBlob(new Blob([JSON.stringify(saved)], { type: 'application/json;charset=utf-8' }), `${filename(project.title)}.long-canvas.json`);
}

export async function loadProjectFile(file: File): Promise<Project> {
  if (!file.size || file.size > MAX_PROJECT_BYTES) fail('请选择128 MB以内的项目文件。');
  let value: unknown;
  try { value = JSON.parse(await file.text()); } catch { return fail('文件不是有效的JSON项目，请选择编辑器保存的项目文件。'); }
  return validateProject(value);
}

const DB_NAME = 'long-canvas-editor-local';
const STORE = 'projects';
let database: Promise<IDBDatabase> | null = null;
function openDatabase(): Promise<IDBDatabase> {
  if (database) return database;
  database = new Promise<IDBDatabase>((resolve, reject) => {
    if (typeof indexedDB === 'undefined') { reject(new Error('当前浏览器不支持本地自动保存，请下载项目文件保存。')); return; }
    const request = indexedDB.open(DB_NAME, 1);
    request.onupgradeneeded = () => { if (!request.result.objectStoreNames.contains(STORE)) request.result.createObjectStore(STORE); };
    request.onsuccess = () => {
      const db = request.result;
      db.onversionchange = () => { db.close(); database = null; };
      resolve(db);
    };
    request.onerror = () => reject(new Error('无法打开本地自动保存，请下载项目文件保存。'));
    request.onblocked = () => reject(new Error('自动保存被另一个窗口占用，请关闭旧窗口后重试。'));
  }).catch(error => { database = null; throw error; });
  return database;
}

/** Receipt and artwork share one transaction, so a reload never replays a saved background revision. */
export async function saveAutosave(project: Project, backgroundUpdateId?: string): Promise<void> {
  const db = await openDatabase();
  await new Promise<void>((resolve, reject) => {
    const transaction = db.transaction(STORE, 'readwrite');
    transaction.objectStore(STORE).put(project, 'latest');
    if (backgroundUpdateId) transaction.objectStore(STORE).put({projectId: project.id, savedAt: new Date().toISOString()}, `background-update:${backgroundUpdateId}`);
    transaction.oncomplete = () => resolve();
    transaction.onerror = transaction.onabort = () => reject(new Error('自动保存失败，本地空间可能不足，请下载项目文件保存。'));
  });
}

export async function hasBackgroundUpdate(updateId: string, projectId: string): Promise<boolean> {
  const db = await openDatabase();
  return new Promise<boolean>((resolve, reject) => {
    const transaction = db.transaction(STORE, 'readonly');
    const request = transaction.objectStore(STORE).get(`background-update:${updateId}`);
    request.onsuccess = () => resolve(request.result?.projectId === projectId);
    request.onerror = () => reject(new Error('无法读取后台更新记录。'));
  });
}

export async function loadAutosave(): Promise<Project | null> {
  const db = await openDatabase();
  const result = await new Promise<unknown>((resolve, reject) => {
    const transaction = db.transaction(STORE, 'readonly');
    const request = transaction.objectStore(STORE).get('latest');
    let value: unknown;
    request.onsuccess = () => { value = request.result; };
    transaction.oncomplete = () => resolve(value);
    transaction.onerror = transaction.onabort = () => reject(new Error('无法读取自动保存的项目。'));
  });
  return result == null ? null : validateProject(result);
}

function checkCanvas(width: number, height: number): void {
  if (!Number.isSafeInteger(width) || !Number.isSafeInteger(height) || width <= 0 || height <= 0 || width > MAX_CANVAS_DIMENSION || height > MAX_CANVAS_DIMENSION || width * height > MAX_CANVAS_PIXELS) {
    fail('图片超过安全导出尺寸（最长边32760像素、总像素3200万）。请缩短页面，或改为逐屏导出PNG。');
  }
}

async function decodedImage(blob: Blob): Promise<{ image: HTMLImageElement; release: () => void }> {
  const url = URL.createObjectURL(blob);
  const image = new Image();
  try {
    if (typeof image.decode === 'function') {
      image.src = url;
      await image.decode();
    } else {
      await new Promise<void>((resolve, reject) => {
        image.onload = () => resolve();
        image.onerror = () => reject(new Error('decode'));
        image.src = url;
      });
    }
    return { image, release: () => { image.src = ''; URL.revokeObjectURL(url); } };
  } catch {
    URL.revokeObjectURL(url);
    return fail('图片无法解码，请检查图片素材，或重新导入损坏的图片。');
  }
}

function pngBlob(canvas: HTMLCanvasElement): Promise<Blob> {
  return new Promise((resolve, reject) => {
    try {
      canvas.toBlob(blob => blob ? resolve(blob) : reject(new Error('PNG生成失败，画布可能超过浏览器内存限制，请改为逐屏导出。')), 'image/png');
    } catch { reject(new Error('PNG导出失败，请检查图片是否全部嵌入项目，并尝试逐屏导出。')); }
  });
}

async function prepareCanvas(width: number, height: number): Promise<{ canvas: HTMLCanvasElement; context: CanvasRenderingContext2D }> {
  checkCanvas(width, height);
  if (document.fonts) await document.fonts.ready;
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext('2d');
  if (!context) { canvas.width = canvas.height = 0; return fail('浏览器内存不足，无法建立导出画布。'); }
  context.fillStyle = '#ffffff';
  context.fillRect(0, 0, width, height);
  return { canvas, context };
}

async function drawPage(context: CanvasRenderingContext2D, project: Project, page: DesignPage, top: number, height: number): Promise<void> {
  const { image, release } = await decodedImage(new Blob([renderPageSvg(project, page)], { type: 'image/svg+xml;charset=utf-8' }));
  try { context.drawImage(image, 0, top, 790, height); } finally { release(); }
}

export async function downloadPagePNG(project: Project, page: DesignPage): Promise<void> {
  const height = Math.ceil(page.height);
  const { canvas, context } = await prepareCanvas(790, height);
  try {
    await drawPage(context, project, page, 0, height);
    saveBlob(await pngBlob(canvas), `${filename(project.title)}-${filename(page.title)}-790px.png`);
  } finally { canvas.width = canvas.height = 0; }
}

export async function downloadLongPNG(project: Project, onProgress?: (completed: number, total: number) => void): Promise<void> {
  if (!project.pages.length) fail('项目没有可导出的页面。');
  const height = project.pages.reduce((sum, page) => sum + Math.ceil(page.height), 0);
  const { canvas, context } = await prepareCanvas(790, height);
  try {
    let top = 0;
    onProgress?.(0, project.pages.length);
    for (let index = 0; index < project.pages.length; index++) {
      const page = project.pages[index];
      const pageHeight = Math.ceil(page.height);
      await drawPage(context, project, page, top, pageHeight);
      top += pageHeight;
      onProgress?.(index + 1, project.pages.length);
      // Release the decoded page before proceeding; allow progress text to repaint.
      await new Promise<void>(resolve => setTimeout(resolve, 0));
    }
    saveBlob(await pngBlob(canvas), `${filename(project.title)}-完整长图-790px.png`);
  } finally { canvas.width = canvas.height = 0; }
}

export async function imageFileToAsset(file: File): Promise<{ id: string; asset: Asset; width: number; height: number }> {
  if (!file.size || file.size > MAX_IMAGE_BYTES) fail('请选择20 MB以内的PNG、JPEG或WebP图片。');
  const bytes = new Uint8Array(await file.arrayBuffer());
  const mime = imageMime(bytes);
  if (!mime || (file.type && file.type !== mime)) fail('只支持PNG、JPEG和WebP图片，不支持SVG、动图或其他文件。');
  const { image, release } = await decodedImage(new Blob([bytes], { type: mime }));
  const width = image.naturalWidth;
  const height = image.naturalHeight;
  release();
  if (width <= 0 || height <= 0 || width > 16384 || height > 16384 || width * height > 40_000_000) fail('图片尺寸过大，请使用边长不超过16384像素、总像素不超过4000万的图片。');
  let binary = '';
  for (let offset = 0; offset < bytes.length; offset += 8192) binary += String.fromCharCode(...bytes.subarray(offset, offset + 8192));
  const asset: Asset = { mime, data: btoa(binary) };
  const assetId = `asset-${globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(36).slice(2)}`}`;
  return { id: assetId, asset, width, height };
}
