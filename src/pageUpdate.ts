import type {Asset, DesignElement, Project} from './types';
import {MAX_PROJECT_BYTES, validateProject} from './projectIO';
import {MIN_SECTION_HEIGHT, MAX_SECTION_HEIGHT, resizeSection} from './sectionResize';

/** A scoped artwork revision: section layout and unrelated edits remain intact. */
export interface PageUpdate {
  kind: 'long-canvas-page-update';
  schemaVersion: 1;
  targetProjectId: string;
  pageId: string;
  sourceWidth: number;
  title: string;
  /** Final 790px-canvas height; omitted revisions retain the current section height. */
  height?: number;
  preserveLayerOrder?: boolean;
  removeElementIds: string[];
  elements: DesignElement[];
  assets: Record<string, Asset>;
}

export function isPageUpdate(value: Project | PageUpdate): value is PageUpdate {
  return 'kind' in value && value.kind === 'long-canvas-page-update';
}

export function validatePageUpdateHeight(value: unknown): number | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== 'number' || !Number.isInteger(value) || value < MIN_SECTION_HEIGHT || value > MAX_SECTION_HEIGHT) {
    throw new Error(`分屏更新高度须为${MIN_SECTION_HEIGHT}–${MAX_SECTION_HEIGHT}px的整数。`);
  }
  return value;
}

function validatePageUpdate(value: Record<string, unknown>): PageUpdate {
  if (value.schemaVersion !== 1) throw new Error('分屏更新版本不受支持。');
  const height = validatePageUpdateHeight(value.height);
  if (value.preserveLayerOrder !== undefined && typeof value.preserveLayerOrder !== 'boolean') throw new Error('分屏图层顺序选项无效。');
  if (!Array.isArray(value.removeElementIds) || value.removeElementIds.length > 3000) {
    throw new Error('分屏更新的替换元素列表无效。');
  }
  const removeElementIds = value.removeElementIds.map(id => {
    if (typeof id !== 'string' || !id.trim() || id.length > 128 || /[\u0000-\u001f\u007f]/.test(id)) {
      throw new Error('分屏更新包含无效的元素标识。');
    }
    return id;
  });
  // Reuse the full project's SVG/asset sanitizer and dimensional limits.
  const checked = validateProject({
    schemaVersion: 1,
    id: value.targetProjectId,
    title: value.title,
    width: 790,
    updatedAt: '2026-01-01T00:00:00.000Z',
    assets: value.assets,
    pages: [{
      id: value.pageId,
      title: value.title,
      width: 790,
      height: 16384,
      sourceWidth: value.sourceWidth,
      defs: '',
      guides: [],
      elements: value.elements,
    }],
  });
  return {
    kind: 'long-canvas-page-update', schemaVersion: 1,
    targetProjectId: checked.id, pageId: checked.pages[0].id,
    sourceWidth: checked.pages[0].sourceWidth, title: checked.title,
    ...(height === undefined ? {} : {height}),
    ...(value.preserveLayerOrder === true ? {preserveLayerOrder: true} : {}),
    removeElementIds: [...new Set(removeElementIds)],
    elements: checked.pages[0].elements, assets: checked.assets,
  };
}

export async function readEditorFile(file: File): Promise<Project | PageUpdate> {
  if (!file.size || file.size > MAX_PROJECT_BYTES) throw new Error('请选择128 MB以内的工程或分屏更新文件。');
  let value: unknown;
  try { value = JSON.parse(await file.text()); }
  catch { throw new Error('文件不是有效的JSON，请选择工程或分屏更新文件。'); }
  if (value && typeof value === 'object' && !Array.isArray(value) && 'kind' in value && value.kind === 'long-canvas-page-update') {
    return validatePageUpdate(value as Record<string, unknown>);
  }
  return validateProject(value);
}

/** Input is sanitized by readEditorFile; merge without rebuilding other pages. */
export function applyPageUpdate(project: Project, revision: PageUpdate): Project {
  const height = validatePageUpdateHeight(revision.height);
  if (project.width !== 790 || project.id !== revision.targetProjectId) {
    throw new Error('此分屏更新不适用于当前工程，请先打开对应的LONG_CANVAS工程。');
  }
  const target = project.pages.find(page => page.id === revision.pageId);
  if (!target) throw new Error('当前工程找不到需要更新的分屏。');
  if (target.width !== 790 || target.sourceWidth !== revision.sourceWidth) {
    throw new Error('分屏原稿尺寸已改变，无法直接应用此更新。');
  }
  for (const [id, asset] of Object.entries(revision.assets)) {
    const existing = project.assets[id];
    if (existing && (existing.mime !== asset.mime || existing.data !== asset.data)) {
      throw new Error(`素材「${id}」与当前工程冲突，更新未应用。`);
    }
  }
  const replaceIds = new Set([...revision.removeElementIds, ...revision.elements.map(element => element.id)]);
  // Adapt retained backgrounds first. Replacement layers already use the revised
  // layout and must not be stretched a second time by the height change.
  const layoutTarget = height === undefined ? target
    : resizeSection(project, target.id, height).pages.find(page => page.id === target.id)!;
  const previous = new Map(target.elements.map(element => [element.id, element]));
  const revised = revision.elements.map(element => {
    const linkId = element.linkId ?? previous.get(element.id)?.linkId;
    const opacity = element.opacity ?? previous.get(element.id)?.opacity;
    return {...element, ...(linkId ? {linkId} : {}), ...(opacity === undefined ? {} : {opacity})};
  });
  const replacements = new Map(revised.map(element => [element.id, element]));
  const removed = new Set(revision.removeElementIds);
  const elements = revision.preserveLayerOrder
    ? [...layoutTarget.elements.filter(element => !removed.has(element.id) || replacements.has(element.id)).map(element => replacements.get(element.id) ?? element), ...revised.filter(element => !previous.has(element.id))]
    : [...layoutTarget.elements.filter(element => !replaceIds.has(element.id)), ...revised];
  if (elements.length > 3000 || project.pages.reduce((total, page) => total + (page === target ? elements.length : page.elements.length), 0) > 30000) {
    throw new Error('更新后的元素数量超出工程限制。');
  }
  const assets = {...project.assets, ...revision.assets};
  if (Object.keys(assets).length > 256) throw new Error('更新后的图片素材超过256张。');
  const assetBytes = Object.values(assets).reduce((total, asset) => total + asset.data.length / 4 * 3 - (asset.data.endsWith('==') ? 2 : asset.data.endsWith('=') ? 1 : 0), 0);
  if (assetBytes > 80 * 1024 * 1024) throw new Error('更新后的素材总大小超过80 MB。');
  const result = {...project, assets, pages: project.pages.map(page => page === target ? {...layoutTarget, elements} : page)};
  if (new Blob([JSON.stringify(result)]).size > MAX_PROJECT_BYTES) throw new Error('更新后的工程超过128 MB。');
  return result;
}
