import type { Box, DesignElement, DesignPage, Project } from './types';
import { isPageBackground, visualBox } from './geometry';
import { prefixSvgIds } from './svgIds';

export interface PageOffset { page: DesignPage; top: number; index: number }
export const LONG_BACKGROUND_ID = '__long-canvas-background__';

/** All layout coordinates are final 790px pixels, even when artwork originated at 750px. */
export function pageOffsets(project: Project): PageOffset[] {
  let top = 0;
  return project.pages.map((page, index) => {
    const offset = { page, top, index };
    top += page.height;
    return offset;
  });
}

export function elementKey(pageId: string, elementId: string): string {
  return JSON.stringify([pageId, elementId]);
}

export function decodeElementKey(key: string): { pageId: string; elementId: string } | null {
  try {
    const value: unknown = JSON.parse(key);
    return Array.isArray(value) && value.length === 2 && value.every(item => typeof item === 'string')
      ? { pageId: value[0], elementId: value[1] } : null;
  } catch { return null; }
}

function number(value: number): string { return String(Number(value.toFixed(10))); }

/** Backgrounds are painted before every foreground so dragging across a module stays visible. */
export function flattenProject(project: Project): DesignPage {
  const offsets = pageOffsets(project);
  const height = offsets.reduce((total, { page }) => total + page.height, 0);
  const backgrounds: DesignElement[] = [{
    id: LONG_BACKGROUND_ID, name: '长画布底色', type: 'shape',
    markup: `<rect width="790" height="${number(height)}" fill="#fff"/>`,
    bbox: { x: 0, y: 0, width: 790, height }, tx: 0, ty: 0, sx: 1, sy: 1,
    locked: true, hidden: false,
  }];
  const foregrounds: DesignElement[] = [];
  const definitions: string[] = [];
  const guides: DesignPage['guides'] = [];
  for (const { page, top, index } of offsets) {
    definitions.push(prefixSvgIds(page.defs, page.id));
    const clipId = `long-canvas-page-clip-${index}`;
    definitions.push(`<clipPath id="${clipId}" clipPathUnits="userSpaceOnUse"><rect x="0" y="${number(top)}" width="790" height="${number(page.height)}"/></clipPath>`);
    for (const [elementIndex, element] of page.elements.entries()) {
      const background = element.locked && isPageBackground(element, page);
      let markup = `<g transform="translate(0 ${number(top)}) scale(${number(790 / page.sourceWidth)})">${prefixSvgIds(element.markup, page.id)}</g>`;
      if (background) {
        let backgroundClip = clipId;
        if ((element.tx || element.ty || element.sx !== 1 || element.sy !== 1) && element.sx > 0 && element.sy > 0) {
          // The renderer applies the editable transform outside markup. Invert that
          // transform for the clip so resized/cropped backgrounds stay in their section.
          backgroundClip = `${clipId}-${elementIndex}`;
          const x = element.bbox.x + (-element.tx - element.bbox.x) / element.sx;
          const y = top + element.bbox.y + (-element.ty - element.bbox.y) / element.sy;
          definitions.push(`<clipPath id="${backgroundClip}" clipPathUnits="userSpaceOnUse"><rect x="${number(x)}" y="${number(y)}" width="${number(790 / element.sx)}" height="${number(page.height / element.sy)}"/></clipPath>`);
        }
        markup = `<g clip-path="url(#${backgroundClip})">${markup}</g>`;
      }
      const flattened = {
        ...element,
        id: elementKey(page.id, element.id),
        markup,
        bbox: { ...element.bbox, y: element.bbox.y + top },
      };
      (background ? backgrounds : foregrounds).push(flattened);
    }
    guides.push(...page.guides.map(guide => ({
      ...guide, id: elementKey(page.id, guide.id), value: guide.value + (guide.axis === 'y' ? top : 0),
    })));
  }
  return {
    id: 'long-canvas', title: project.title, width: 790, sourceWidth: 790, height,
    defs: definitions.join(''), elements: [...backgrounds, ...foregrounds], guides,
  };
}

const sameNumber = (a: number, b: number) => Math.abs(a - b) < 1e-7;
const sameBox = (a: Box, b: Box) => sameNumber(a.x, b.x) && sameNumber(a.y, b.y)
  && sameNumber(a.width, b.width) && sameNumber(a.height, b.height);

/** Copy editable geometry back only; never persist flattened wrappers or synthetic layers. */
export function applyFlatTransforms(project: Project, flatPage: DesignPage): Project {
  const lookup = new Map(flatPage.elements.map(element => [element.id, element]));
  let changed = false;
  const pages = pageOffsets(project).map(({ page, top }) => {
    let pageChanged = false;
    const elements = page.elements.map(element => {
      const flat = lookup.get(elementKey(page.id, element.id));
      if (!flat) return element;
      const bbox = { ...flat.bbox, y: flat.bbox.y - top };
      if (![bbox.x, bbox.y, bbox.width, bbox.height, flat.tx, flat.ty, flat.sx, flat.sy].every(Number.isFinite)) return element;
      if (sameBox(bbox, element.bbox) && sameNumber(flat.tx, element.tx) && sameNumber(flat.ty, element.ty)
        && sameNumber(flat.sx, element.sx) && sameNumber(flat.sy, element.sy)) return element;
      pageChanged = changed = true;
      return { ...element, bbox, tx: flat.tx, ty: flat.ty, sx: flat.sx, sy: flat.sy };
    });
    return pageChanged ? { ...page, elements } : page;
  });
  return changed ? { ...project, pages } : project;
}

function destinationAt(offsets: PageOffset[], globalY: number): PageOffset {
  return offsets.find(({ top, page }) => globalY < top + page.height) ?? offsets[offsets.length - 1];
}

function hash(value: string): string {
  let result = 2166136261;
  for (let index = 0; index < value.length; index += 1) result = Math.imul(result ^ value.charCodeAt(index), 16777619);
  return (result >>> 0).toString(36);
}

/** Keep the referenced definition closure, avoiding recursive copies of unrelated page defs. */
export function referencedDefinitions(markup: string, definitions: string): string {
  const blocks: string[] = [];
  let depth = 0;
  let start = 0;
  const tags = /<(?:[^"'<>]|"[^"]*"|'[^']*')*>/g;
  for (const match of definitions.matchAll(tags)) {
    const tag = match[0];
    if (/^<[!?]/.test(tag)) continue;
    if (/^<\//.test(tag)) {
      depth -= 1;
      if (depth === 0) blocks.push(definitions.slice(start, match.index! + tag.length));
    } else {
      if (depth === 0) start = match.index!;
      if (/\/\s*>$/.test(tag)) {
        if (depth === 0) blocks.push(tag);
      } else depth += 1;
    }
  }
  const ids = new Map<string, number>();
  blocks.forEach((block, index) => {
    for (const match of block.matchAll(/\sid\s*=\s*(["'])([^"']+)\1/g)) ids.set(match[2], index);
  });
  const references = (value: string) => [
    ...Array.from(value.matchAll(/url\(\s*(["']?)#([^\s)'"\(]+)\1\s*\)/g), match => match[2]),
    ...Array.from(value.matchAll(/\s(?:xlink:)?href\s*=\s*(["'])#([^"']+)\1/g), match => match[2]),
  ];
  const pending = references(markup);
  const included = new Set<number>();
  for (let cursor = 0; cursor < pending.length; cursor += 1) {
    const index = ids.get(pending[cursor]);
    if (index === undefined || included.has(index)) continue;
    included.add(index);
    pending.push(...references(blocks[index]));
  }
  return blocks.filter((_block, index) => included.has(index)).join('');
}

/** Move in global coordinates, assigning an element to the module containing its final center. */
export function relocateElementsWithSelection(
  project: Project, keys: readonly string[], dx: number, dy: number, transfer = true,
): { project: Project; selected: string[] } {
  if (!Number.isFinite(dx) || !Number.isFinite(dy) || project.pages.length === 0) {
    return { project, selected: [...keys] };
  }
  const offsets = pageOffsets(project);
  const wanted = new Set(keys);
  const movedKeys = new Map<string, string>();
  const removals = new Map<string, Set<string>>();
  const replacements = new Map<string, Map<string, DesignElement>>();
  const additions = new Map<string, DesignElement[]>();
  const definitions = new Map<string, string>();
  const occupied = new Map(project.pages.map(page => [page.id, new Set(page.elements.map(element => element.id))]));
  let changed = false;
  for (const source of offsets) {
    for (const element of source.page.elements) {
      const key = elementKey(source.page.id, element.id);
      if (!wanted.has(key) || element.locked || element.hidden) continue;
      const box = visualBox(element);
      const centerY = source.top + box.y + dy + box.height / 2;
      const target = transfer ? destinationAt(offsets, centerY) : source;
      if (source.page.id === target.page.id) {
        if (dx === 0 && dy === 0) continue;
        const replacement = { ...element, tx: element.tx + dx, ty: element.ty + dy };
        if (!replacements.has(source.page.id)) replacements.set(source.page.id, new Map());
        replacements.get(source.page.id)!.set(element.id, replacement);
        changed = true;
        continue;
      }

      let id = element.id;
      const targetIds = occupied.get(target.page.id)!;
      if (targetIds.has(id)) {
        // Imported metadata IDs may already reach the 128-character storage limit.
        const base = `${id.slice(0, 84)}-from-${source.page.id.slice(0, 28)}`;
        id = base;
        for (let suffix = 2; targetIds.has(id); suffix += 1) id = `${base}-${suffix}`;
      }
      targetIds.add(id);
      // The namespace incorporates source content, so two modules with e.g. "fade" never collide.
      const neededDefs = referencedDefinitions(element.markup, source.page.defs);
      const scope = `move-${source.page.id}-${element.id}-${hash(neededDefs)}`;
      const prefixedDefs = prefixSvgIds(neededDefs, scope);
      const existingDefs = definitions.get(target.page.id) ?? target.page.defs;
      if (prefixedDefs && !existingDefs.includes(prefixedDefs)) definitions.set(target.page.id, existingDefs + prefixedDefs);
      const difference = source.top - target.top;
      const targetScale = 790 / target.page.sourceWidth;
      const ratio = target.page.sourceWidth / source.page.sourceWidth;
      const markup = `<g transform="translate(0 ${number(difference / targetScale)}) scale(${number(ratio)})">${prefixSvgIds(element.markup, scope)}</g>`;
      const relocated: DesignElement = {
        ...element, id, markup, bbox: { ...element.bbox, y: element.bbox.y + difference },
        tx: element.tx + dx, ty: element.ty + dy,
      };
      if (!removals.has(source.page.id)) removals.set(source.page.id, new Set());
      removals.get(source.page.id)!.add(element.id);
      if (!additions.has(target.page.id)) additions.set(target.page.id, []);
      additions.get(target.page.id)!.push(relocated);
      movedKeys.set(key, elementKey(target.page.id, id));
      changed = true;
    }
  }
  if (!changed) return { project, selected: [...keys] };
  const pages = project.pages.map(page => {
    const removed = removals.get(page.id);
    const replaced = replacements.get(page.id);
    const added = additions.get(page.id);
    if (!removed && !replaced && !added && !definitions.has(page.id)) return page;
    const elements = page.elements.filter(element => !removed?.has(element.id))
      .map(element => replaced?.get(element.id) ?? element);
    return { ...page, defs: definitions.get(page.id) ?? page.defs, elements: added ? [...elements, ...added] : elements };
  });
  return { project: { ...project, pages }, selected: keys.map(key => movedKeys.get(key) ?? key) };
}

export function relocateElements(project: Project, keys: readonly string[], dx: number, dy: number, transfer = true): Project {
  return relocateElementsWithSelection(project, keys, dx, dy, transfer).project;
}
