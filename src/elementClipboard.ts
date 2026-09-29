import type {Asset, DesignElement, Project} from './types';
import {unionBoxes, visualBox} from './geometry';
import {elementKey, pageOffsets, referencedDefinitions} from './longLayout';
import {drawingTags, prefixSvgIds} from './svgIds';

interface CapturedPage {
  readonly id: string;
  readonly sourceWidth: number;
  /** Final-pixel offset from the first selected page, preserving cross-page layouts. */
  readonly offset: number;
  readonly defs: string;
  readonly elements: readonly DesignElement[];
}

/** Private, in-memory clipboard captured only from a loaded, sanitized project. */
export interface ElementClipboard {
  readonly sourceProjectId: string;
  readonly sourcePageIds: readonly string[];
  readonly count: number;
  readonly pages: readonly CapturedPage[];
  readonly assets: Readonly<Record<string, Asset>>;
}

function number(value: number): string { return String(Number(value.toFixed(10))); }
function assetReferences(markup: string): string[] {
  const ids: string[] = [];
  drawingTags(markup, tag => {
    for (const match of tag.matchAll(/\s(?:xlink:)?href\s*=\s*(["'])asset:([^"']+)\1/gi)) ids.push(match[2]);
    return tag;
  });
  return ids;
}
function remapAssets(markup: string, ids: ReadonlyMap<string, string>): string {
  return drawingTags(markup, tag => tag.replace(/\s((?:xlink:)?href)\s*=\s*(["'])asset:([^"']+)\2/gi,
    (_match, attribute: string, quote: string, id: string) => ` ${attribute}=${quote}asset:${ids.get(id) ?? id}${quote}`));
}

/** Capture values, not live objects: cut, later edits and project imports cannot change a copy. */
export function captureElements(project: Project, keys: readonly string[]): ElementClipboard | null {
  const wanted = new Set(keys);
  const pages: CapturedPage[] = [];
  const assets: Record<string, Asset> = {};
  let anchor: number | undefined;
  let count = 0;
  for (const {page, top} of pageOffsets(project)) {
    const elements = page.elements.filter(element => wanted.has(elementKey(page.id, element.id)) && !element.locked && !element.hidden)
      .map(element => ({...element, bbox: {...element.bbox}}));
    if (!elements.length) continue;
    anchor ??= top;
    const markup = elements.map(element => element.markup).join('');
    const defs = referencedDefinitions(markup, page.defs);
    for (const id of assetReferences(markup + defs)) {
      if (!Object.prototype.hasOwnProperty.call(project.assets, id)) throw new Error(`找不到图片素材「${id}」，未复制元素。`);
      Object.defineProperty(assets, id, {value: {...project.assets[id]}, enumerable: true, writable: true, configurable: true});
    }
    pages.push({id: page.id, sourceWidth: page.sourceWidth, offset: top - anchor, defs, elements});
    count += elements.length;
  }
  return count ? {sourceProjectId: project.id, sourcePageIds: pages.map(page => page.id), count, pages, assets} : null;
}

/** Keep the whole selection in view when possible; oversized groups retain their dimensions. */
function containedPosition(position: number, size: number, extent: number): number {
  return Math.max(0, Math.min(position, Math.max(0, extent - size)));
}

export function pasteElements(
  project: Project, clipboard: ElementClipboard, targetPageId: string, pasteIndex = 0,
): {project: Project; selected: string[]} {
  const target = project.pages.find(page => page.id === targetPageId);
  if (!target || !clipboard.count || !clipboard.pages.length) return {project, selected: []};
  if (target.elements.length + clipboard.count > 3000 || project.pages.reduce((sum, page) => sum + page.elements.length, 0) + clipboard.count > 30000) {
    throw new Error('粘贴后的图层数量超出工程限制。');
  }

  let assets = project.assets;
  const assetIds = new Map<string, string>();
  for (const [id, asset] of Object.entries(clipboard.assets)) {
    const existing = Object.prototype.hasOwnProperty.call(assets, id) ? assets[id] : undefined;
    const identical = existing && existing.mime === asset.mime && existing.data === asset.data;
    let nextId = id;
    if (existing && !identical) {
      // A different open project may already use this asset name for another image.
      nextId = Object.keys(assets).find(key => assets[key].mime === asset.mime && assets[key].data === asset.data) ?? `paste-asset-${crypto.randomUUID()}`;
    }
    assetIds.set(id, nextId);
    if (!Object.prototype.hasOwnProperty.call(assets, nextId)) {
      if (assets === project.assets) assets = {...assets};
      Object.defineProperty(assets, nextId, {value: {...asset}, enumerable: true, writable: true, configurable: true});
    }
  }
  if (Object.keys(assets).length > 256) throw new Error('粘贴后的图片素材超过256张。');
  const assetBytes = Object.values(assets).reduce((sum, asset) => sum + asset.data.length / 4 * 3 - (asset.data.endsWith('==') ? 2 : asset.data.endsWith('=') ? 1 : 0), 0);
  if (assetBytes > 80 * 1024 * 1024) throw new Error('粘贴后的素材总大小超过80 MB。');

  const bounds = unionBoxes(clipboard.pages.flatMap(page => page.elements.map(element => {
    const box = visualBox(element);
    return {...box, y: box.y + page.offset};
  })));
  const samePage = clipboard.sourceProjectId === project.id && clipboard.sourcePageIds.length === 1 && clipboard.sourcePageIds[0] === target.id;
  const offset = 16 * ((Number.isFinite(pasteIndex) ? Math.max(0, Math.floor(pasteIndex)) : 0) + (samePage ? 1 : 0));
  const dx = containedPosition(bounds.x + offset, bounds.width, target.width) - bounds.x;
  const dy = containedPosition(bounds.y + offset, bounds.height, target.height) - bounds.y;
  const links = new Map<string, string>();
  const added: DesignElement[] = [];
  let defs = target.defs;
  for (const page of clipboard.pages) {
    const scope = `paste-${crypto.randomUUID()}`;
    defs += prefixSvgIds(remapAssets(page.defs, assetIds), scope);
    const targetScale = project.width / target.sourceWidth;
    const ratio = target.sourceWidth / page.sourceWidth;
    for (const element of page.elements) {
      let markup = prefixSvgIds(remapAssets(element.markup, assetIds), scope);
      if (page.offset || ratio !== 1) markup = `<g transform="translate(0 ${number(page.offset / targetScale)}) scale(${number(ratio)})">${markup}</g>`;
      const copied = {
        ...element, id: crypto.randomUUID(), name: `${element.name} 副本`.slice(0, 200), markup,
        bbox: {...element.bbox, y: element.bbox.y + page.offset}, tx: element.tx + dx, ty: element.ty + dy,
      };
      if (element.linkId) {
        if (!links.has(element.linkId)) links.set(element.linkId, crypto.randomUUID());
        copied.linkId = links.get(element.linkId);
      }
      added.push(copied);
    }
  }
  if (defs.length > 2 * 1024 * 1024) throw new Error('当前分屏的图形定义过多，请减少粘贴图层。');
  const result = {...project, assets, pages: project.pages.map(page => page === target ? {...page, defs, elements: [...page.elements, ...added]} : page)};
  if (new Blob([JSON.stringify(result)]).size > 128 * 1024 * 1024) throw new Error('粘贴后的工程超过128 MB。');
  return {project: result, selected: added.map(element => elementKey(target.id, element.id))};
}
