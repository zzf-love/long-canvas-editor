import type { DesignElement, DesignPage, Project } from './types';
import { isPageBackground, visualBox } from './geometry';

export const MIN_SECTION_HEIGHT = 400;
export const MAX_SECTION_HEIGHT = 6000;

/** NaN deliberately remains invalid: callers can reject unfinished numeric input. */
export function normalizeSectionHeight(height: number): number {
  return Number.isFinite(height)
    ? Math.max(MIN_SECTION_HEIGHT, Math.min(MAX_SECTION_HEIGHT, Math.round(height))) : NaN;
}

const number = (value: number) => String(Number(value.toFixed(10)));
const openingTag = /^\s*<(image|rect|svg)\b(?:[^"'<>]|"[^"]*"|'[^']*')*>/;
function attribute(tag: string, name: string): string | undefined {
  return tag.match(new RegExp(`\\s${name}\\s*=\\s*(["'])(.*?)\\1`))?.[2];
}
function setAttribute(tag: string, name: string, value: string): string {
  const pattern = new RegExp(`\\s${name}\\s*=\\s*(["'])(.*?)\\1`);
  return pattern.test(tag) ? tag.replace(pattern, ` ${name}="${value}"`)
    : tag.replace(/\s*\/?>$/, ending => ` ${name}="${value}"${ending}`);
}

/** Resize the viewport instead of vertically stretching a background photograph. */
function resizeBackground(element: DesignElement, page: DesignPage, height: number): DesignElement {
  const ratio = height / page.height;
  const factor = page.width / page.sourceWidth;
  if (!(factor > 0) || !(element.sy > 0)) return element;
  const before = visualBox(element);
  // Cover the complete new section, also repairing the seed's subpixel height rounding.
  // Any existing overscan remains proportional to the section height.
  const top = Math.min(0, before.y * ratio);
  const bottom = Math.max(height, (before.y + before.height) * ratio);
  const ty = element.ty * ratio;
  const bbox = { ...element.bbox, y: top - ty, height: (bottom - top) / element.sy };
  const match = element.markup.match(openingTag);
  let markup: string;
  const tag = match?.[0];
  const root = match?.[1];
  const simpleRoot = root === 'svg' ? /<\/svg>\s*$/.test(element.markup)
    : tag && (/\/\s*>$/.test(tag) ? element.markup.slice(tag.length).trim() === ''
      : new RegExp(`^\\s*<\\/${root}>\\s*$`).test(element.markup.slice(tag.length)));
  const style = tag ? attribute(tag, 'style') ?? '' : '';
  if (tag && simpleRoot && !attribute(tag, 'transform') && !/(?:^|;)\s*(?:x|y|width|height|transform)\s*:/.test(style)) {
    let changed = setAttribute(tag, 'y', number(bbox.y / factor));
    changed = setAttribute(changed, 'height', number(bbox.height / factor));
    if (root === 'image' || root === 'svg') {
      // Keep the user's crop alignment while always covering the expanded viewport.
      const alignment = attribute(tag, 'preserveAspectRatio')?.match(/x(?:Min|Mid|Max)Y(?:Min|Mid|Max)/)?.[0] ?? 'xMidYMid';
      changed = setAttribute(changed, 'preserveAspectRatio', `${alignment} slice`);
    }
    markup = changed + element.markup.slice(tag.length);
  } else {
    // Imported groups/transforms are kept intact inside a uniformly scaled crop.
    // Later resizes edit this root viewport, avoiding accumulating nested wrappers.
    const old = element.bbox;
    markup = `<svg x="${number(old.x / factor)}" y="${number(bbox.y / factor)}" width="${number(old.width / factor)}" height="${number(bbox.height / factor)}" viewBox="${number(old.x / factor)} ${number(old.y / factor)} ${number(old.width / factor)} ${number(old.height / factor)}" preserveAspectRatio="xMidYMid slice" overflow="hidden">${element.markup}</svg>`;
  }
  return { ...element, markup, bbox, ty };
}

/** Foregrounds keep their local geometry; subsequent sections move through pageOffsets. */
export function resizeSection(project: Project, pageId: string, requestedHeight: number): Project {
  const height = normalizeSectionHeight(requestedHeight);
  if (!Number.isFinite(height)) return project;
  const page = project.pages.find(item => item.id === pageId);
  if (!page || page.height === height || !(page.height > 0)) return project;
  const elements = page.elements.map(element => element.locked && isPageBackground(element, page)
    ? resizeBackground(element, page, height) : element);
  const resized = { ...page, height, elements };
  return { ...project, pages: project.pages.map(item => item === page ? resized : item) };
}
