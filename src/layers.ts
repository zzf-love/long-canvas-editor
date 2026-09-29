import type { DesignElement, DesignPage, Project } from './types';
import { isPageBackground } from './geometry';
import { elementKey } from './longLayout';

export type LayerDirection = 'up' | 'down' | 'front' | 'back';
export type LayerPlacement = 'before' | 'after';

/** These layers are painted below all foregrounds by the continuous canvas. */
export function isLayerBackdrop(element: DesignElement, page: DesignPage): boolean {
  return element.locked && isPageBackground(element, page);
}

function entries(project: Project): { key: string; element: DesignElement }[] {
  return project.pages.flatMap(page => page.elements.map(element => ({
    key: elementKey(page.id, element.id), element,
  })));
}

/** Keep direct selections inspectable; only unlocked, visible peers are added automatically. */
export function expandLinkedSelection(project: Project, keys: readonly string[]): string[] {
  const all = entries(project);
  const lookup = new Map(all.map(entry => [entry.key, entry.element]));
  const selected = new Set(keys.filter(key => lookup.has(key)));
  const links = new Set([...selected].map(key => lookup.get(key)!.linkId).filter(Boolean));
  if (!links.size) return [...selected];
  for (const { key, element } of all) {
    if (element.linkId && links.has(element.linkId) && !element.locked && !element.hidden) selected.add(key);
  }
  return [...selected];
}

function replaceLinks(project: Project, change: (element: DesignElement, key: string) => string | undefined): Project {
  let changed = false;
  const pages = project.pages.map(page => {
    let pageChanged = false;
    const elements = page.elements.map(element => {
      const linkId = change(element, elementKey(page.id, element.id));
      if (linkId === element.linkId) return element;
      pageChanged = changed = true;
      const { linkId: _oldLink, ...unlinked } = element;
      return linkId === undefined ? unlinked : { ...unlinked, linkId };
    });
    return pageChanged ? { ...page, elements } : page;
  });
  return changed ? { ...project, pages } : project;
}

/** Merge whole existing associations, including their locked/hidden members, without fragmenting them. */
export function linkElements(project: Project, keys: readonly string[], linkId: string): Project {
  if (!linkId.trim() || linkId.length > 128 || /[\u0000-\u001f\u007f]/.test(linkId)) {
    throw new Error('图层链接标识无效。');
  }
  const wanted = new Set(keys);
  const all = entries(project);
  const direct = all.filter(({ key, element }) => wanted.has(key) && !element.locked && !element.hidden);
  if (!direct.length) return project;
  const directKeys = new Set(direct.map(({ key }) => key));
  const oldLinks = new Set(direct.map(({ element }) => element.linkId).filter(Boolean));
  // Also make a caller-supplied existing ID an explicit merge, never a partial association.
  oldLinks.add(linkId);
  const members = new Set(all.filter(({ key, element }) => directKeys.has(key)
    || (element.linkId && oldLinks.has(element.linkId))).map(({ key }) => key));
  if (members.size < 2) return project;
  return replaceLinks(project, (element, key) => members.has(key) ? linkId : element.linkId);
}

/** Unlink dissolves the chosen associations project-wide, leaving no stranded single-member link. */
export function unlinkElements(project: Project, keys: readonly string[]): Project {
  const wanted = new Set(keys);
  const links = new Set(entries(project)
    .filter(({ key, element }) => wanted.has(key) && element.linkId)
    .map(({ element }) => element.linkId!));
  if (!links.size) return project;
  return replaceLinks(project, element => element.linkId && links.has(element.linkId) ? undefined : element.linkId);
}

function replaceForegroundOrder(page: DesignPage, ordered: DesignElement[]): DesignPage {
  let index = 0;
  // Keep background slots intact; their visual priority is independent of array position.
  const elements = page.elements.map(element => isLayerBackdrop(element, page) ? element : ordered[index++]);
  return elements.every((element, position) => element === page.elements[position]) ? page : { ...page, elements };
}

/** Project arrays run back-to-front. Every selected run moves one visible stacking step. */
export function reorderLayers(project: Project, keys: readonly string[], direction: LayerDirection): Project {
  const wanted = new Set(keys);
  let changed = false;
  const pages = project.pages.map(page => {
    const foregrounds = page.elements.filter(element => !isLayerBackdrop(element, page));
    const selected = new Set(foregrounds.filter(element => !element.locked
      && wanted.has(elementKey(page.id, element.id))).map(element => element.id));
    if (!selected.size) return page;
    let ordered = [...foregrounds];
    if (direction === 'up') {
      for (let index = ordered.length - 2; index >= 0; index -= 1) {
        if (selected.has(ordered[index].id) && !selected.has(ordered[index + 1].id)) {
          [ordered[index], ordered[index + 1]] = [ordered[index + 1], ordered[index]];
        }
      }
    } else if (direction === 'down') {
      for (let index = 1; index < ordered.length; index += 1) {
        if (selected.has(ordered[index].id) && !selected.has(ordered[index - 1].id)) {
          [ordered[index], ordered[index - 1]] = [ordered[index - 1], ordered[index]];
        }
      }
    } else {
      const moving = ordered.filter(element => selected.has(element.id));
      const rest = ordered.filter(element => !selected.has(element.id));
      ordered = direction === 'front' ? [...rest, ...moving] : [...moving, ...rest];
    }
    const next = replaceForegroundOrder(page, ordered);
    if (next !== page) changed = true;
    return next;
  });
  return changed ? { ...project, pages } : project;
}

/** `before`/`after` are array (back-to-front) order. Dragging keeps selected layers' relative order. */
export function moveLayerTo(
  project: Project, pageId: string, movingIds: readonly string[], targetId: string, placement: LayerPlacement,
): Project {
  const page = project.pages.find(page => page.id === pageId);
  if (!page) return project;
  const target = page.elements.find(element => element.id === targetId);
  if (!target || isLayerBackdrop(target, page)) return project;
  const wanted = new Set(movingIds);
  const foregrounds = page.elements.filter(element => !isLayerBackdrop(element, page));
  const moving = foregrounds.filter(element => wanted.has(element.id) && !element.locked);
  if (!moving.length || moving.includes(target)) return project;
  const movingSet = new Set(moving);
  const ordered = foregrounds.filter(element => !movingSet.has(element));
  const targetIndex = ordered.indexOf(target);
  ordered.splice(targetIndex + (placement === 'after' ? 1 : 0), 0, ...moving);
  const next = replaceForegroundOrder(page, ordered);
  return next === page ? project : { ...project, pages: project.pages.map(item => item === page ? next : item) };
}
