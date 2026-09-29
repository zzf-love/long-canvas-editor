import type { Asset, DesignPage, Project } from './types';
import { visualBox } from './geometry';
import { flattenProject, pageOffsets } from './longLayout';
import { drawingTags, prefixSvgIds } from './svgIds';

export { prefixSvgIds } from './svgIds';

export const SVG_FONT = 'PingFang SC, -apple-system, BlinkMacSystemFont, sans-serif';

function xml(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/** Resolve only local project assets; a missing asset is an export error, never a network request. */
export function resolveMarkup(markup: string, assets: Record<string, Asset>): string {
  return drawingTags(markup, tag => tag.replace(/\s((?:xlink:)?href)\s*=\s*(["'])asset:([^"']+)\2/gi, (_match, attr: string, _quote: string, id: string) => {
    const asset = Object.prototype.hasOwnProperty.call(assets, id) ? assets[id] : undefined;
    if (!asset) throw new Error(`找不到图片素材「${id}」，请重新导入该图片。`);
    if (!/^image\/(png|jpeg|webp)$/.test(asset.mime) || !/^[A-Za-z0-9+/]*={0,2}$/.test(asset.data)) {
      throw new Error(`图片素材「${id}」格式无效。`);
    }
    return ` ${attr}="data:${asset.mime};base64,${asset.data}"`;
  }));
}

function forceFont(markup: string): string {
  return drawingTags(markup, tag => tag
    .replace(/\bfont-family\s*=\s*(["'])(.*?)\1/gi, `font-family="${SVG_FONT}"`)
    .replace(/font-family\s*:\s*[^;"']+/gi, `font-family: ${SVG_FONT}`));
}

function number(value: number): string {
  if (!Number.isFinite(value)) throw new Error('页面包含无效的位置或尺寸，无法导出。');
  return String(Number(value.toFixed(6)));
}

/** Export a slice of the continuous artwork, including elements moved across section boundaries. */
export function renderPageSvg(project: Project, page: DesignPage): string {
  if (project.width !== 790 || page.width !== 790 || page.height <= 0 || page.sourceWidth <= 0) {
    throw new Error('页面尺寸无效：项目和页面宽度必须为790像素。');
  }
  const scope = `${project.id}-${page.id}`;
  const prepare = (markup: string) => forceFont(prefixSvgIds(resolveMarkup(markup, project.assets), scope));
  const offset = pageOffsets(project).find(item => item.page.id === page.id);
  // A detached page is still useful for callers rendering an isolated composition.
  const composition = offset ? flattenProject(project) : flattenProject({ ...project, pages: [page] });
  const top = offset?.top ?? 0;
  const bottom = top + page.height;
  // Include a small margin for strokes and shadows, while avoiding embedding every raster
  // asset in every slice. The outer SVG viewport remains the final exact crop.
  const bleed = 64;
  const elements = composition.elements.filter(element => {
    if (element.hidden) return false;
    const box = visualBox(element);
    return box.x + box.width >= -bleed && box.x <= page.width + bleed
      && box.y + box.height >= top - bleed && box.y <= bottom + bleed;
  }).map(element => {
    const b = element.bbox;
    const transform = `translate(${number(element.tx)} ${number(element.ty)}) translate(${number(b.x)} ${number(b.y)}) scale(${number(element.sx)} ${number(element.sy)}) translate(${number(-b.x)} ${number(-b.y)})`;
    // Composite the complete layer once, preserving gradients and nested SVG opacity.
    const opacity = element.opacity === undefined ? '' : ` opacity="${number(element.opacity)}"`;
    return `<g transform="${transform}"${opacity}>${prepare(element.markup)}</g>`;
  }).join('');
  return `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="790" height="${number(page.height)}" viewBox="0 ${number(top)} 790 ${number(page.height)}" font-family="${xml(SVG_FONT)}"><defs>${prepare(composition.defs)}</defs>${elements}</svg>`;
}
