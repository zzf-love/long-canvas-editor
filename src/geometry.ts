import type { AlignMode, Box, DesignElement, DesignPage, SnapLine } from './types';

/** Scaling is anchored to the original bounding box's top-left corner. */
export function visualBox(el: DesignElement): Box {
  return {
    x: el.bbox.x + el.tx,
    y: el.bbox.y + el.ty,
    width: el.bbox.width * el.sx,
    height: el.bbox.height * el.sy,
  };
}

export function unionBoxes(boxes: readonly Box[]): Box {
  if (boxes.length === 0) return { x: 0, y: 0, width: 0, height: 0 };
  const x = Math.min(...boxes.map(box => box.x));
  const y = Math.min(...boxes.map(box => box.y));
  return {
    x,
    y,
    width: Math.max(...boxes.map(box => box.x + box.width)) - x,
    height: Math.max(...boxes.map(box => box.y + box.height)) - y,
  };
}

export function editableSelection(page: DesignPage, ids: readonly string[]): DesignElement[] {
  const selected = new Set(ids);
  return page.elements.filter(el => selected.has(el.id) && !el.locked && !el.hidden);
}

function applyOffsets(
  page: DesignPage,
  offsets: ReadonlyMap<string, { dx: number; dy: number }>,
): DesignPage {
  let changed = false;
  const elements = page.elements.map(el => {
    const offset = offsets.get(el.id);
    if (!offset || (offset.dx === 0 && offset.dy === 0)) return el;
    changed = true;
    return { ...el, tx: el.tx + offset.dx, ty: el.ty + offset.dy };
  });
  return changed ? { ...page, elements } : page;
}

export function alignElements(
  page: DesignPage,
  ids: readonly string[],
  mode: AlignMode,
  target: 'page' | 'selection',
): DesignPage {
  const elements = editableSelection(page, ids);
  if (elements.length === 0) return page;
  const bounds = target === 'page' || elements.length === 1
    ? { x: 0, y: 0, width: page.width, height: page.height }
    : unionBoxes(elements.map(visualBox));
  const offsets = new Map<string, { dx: number; dy: number }>();

  for (const el of elements) {
    const box = visualBox(el);
    let dx = 0;
    let dy = 0;
    switch (mode) {
      case 'left': dx = bounds.x - box.x; break;
      case 'centerX': dx = bounds.x + bounds.width / 2 - box.x - box.width / 2; break;
      case 'right': dx = bounds.x + bounds.width - box.x - box.width; break;
      case 'top': dy = bounds.y - box.y; break;
      case 'centerY': dy = bounds.y + bounds.height / 2 - box.y - box.height / 2; break;
      case 'bottom': dy = bounds.y + bounds.height - box.y - box.height; break;
    }
    offsets.set(el.id, { dx, dy });
  }
  return applyOffsets(page, offsets);
}

/** Equal edge-to-edge gaps; keep the first and last elements in place. */
export function distributeElements(
  page: DesignPage,
  ids: readonly string[],
  axis: 'x' | 'y',
): DesignPage {
  const dimension = axis === 'x' ? 'width' : 'height';
  const elements = editableSelection(page, ids)
    .map(el => ({ el, box: visualBox(el) }))
    .sort((a, b) => a.box[axis] - b.box[axis]);
  if (elements.length < 3) return page;

  const first = elements[0].box;
  const last = elements[elements.length - 1].box;
  const occupied = elements.reduce((sum, { box }) => sum + box[dimension], 0);
  const gap = (last[axis] + last[dimension] - first[axis] - occupied) / (elements.length - 1);
  let cursor = first[axis] + first[dimension] + gap;
  const offsets = new Map<string, { dx: number; dy: number }>();
  for (let i = 1; i < elements.length - 1; i += 1) {
    const { el, box } = elements[i];
    const delta = cursor - box[axis];
    offsets.set(el.id, { dx: axis === 'x' ? delta : 0, dy: axis === 'y' ? delta : 0 });
    cursor += box[dimension] + gap;
  }
  return applyOffsets(page, offsets);
}

function anchors(box: Box, axis: 'x' | 'y'): number[] {
  const start = box[axis];
  const size = axis === 'x' ? box.width : box.height;
  return [start, start + size / 2, start + size];
}

/** Ignore near-full-page artwork as a snap target, while keeping page snaps. */
export function isPageBackground(el: DesignElement, page: DesignPage): boolean {
  if (el.type === 'text' || page.width <= 0 || page.height <= 0) return false;
  const box = visualBox(el);
  const overlapWidth = Math.max(0, Math.min(page.width, box.x + box.width) - Math.max(0, box.x));
  const overlapHeight = Math.max(0, Math.min(page.height, box.y + box.height) - Math.max(0, box.y));
  return overlapWidth >= page.width * 0.9 && overlapHeight >= page.height * 0.9;
}

interface SnapTarget { value: number; priority: number }

function closestSnap(
  moving: readonly number[],
  targets: readonly SnapTarget[],
  threshold: number,
): { delta: number; value: number } | undefined {
  let best: { delta: number; value: number; distance: number; priority: number } | undefined;
  for (const target of targets) {
    for (const position of moving) {
      const delta = target.value - position;
      const distance = Math.abs(delta);
      if (distance > threshold) continue;
      if (!best || distance < best.distance - 1e-9
        || (Math.abs(distance - best.distance) <= 1e-9 && target.priority < best.priority)) {
        best = { delta, value: target.value, distance, priority: target.priority };
      }
    }
  }
  return best && { delta: best.delta, value: best.value };
}

export function snapMove(
  page: DesignPage,
  ids: readonly string[],
  dx: number,
  dy: number,
  threshold: number,
): { dx: number; dy: number; lines: SnapLine[] } {
  const moving = editableSelection(page, ids);
  if (moving.length === 0) return { dx, dy, lines: [] };
  const selected = new Set(ids);
  const box = unionBoxes(moving.map(visualBox));
  const proposed = { ...box, x: box.x + dx, y: box.y + dy };
  const targets: Record<'x' | 'y', SnapTarget[]> = {
    x: [0, page.width / 2, page.width].map(value => ({ value, priority: 1 })),
    y: [0, page.height / 2, page.height].map(value => ({ value, priority: 1 })),
  };
  for (const guide of page.guides) {
    if (Number.isFinite(guide.value)) targets[guide.axis].push({ value: guide.value, priority: 0 });
  }
  for (const el of page.elements) {
    if (selected.has(el.id) || el.hidden || isPageBackground(el, page)) continue;
    const other = visualBox(el);
    for (const axis of ['x', 'y'] as const) {
      targets[axis].push(...anchors(other, axis).map(value => ({ value, priority: 2 })));
    }
  }
  const limit = Number.isFinite(threshold) ? Math.max(0, threshold) : 0;
  const xSnap = closestSnap(anchors(proposed, 'x'), targets.x, limit);
  const ySnap = closestSnap(anchors(proposed, 'y'), targets.y, limit);
  const lines: SnapLine[] = [];
  if (xSnap) lines.push({ axis: 'x', value: xSnap.value });
  if (ySnap) lines.push({ axis: 'y', value: ySnap.value });
  return { dx: dx + (xSnap?.delta ?? 0), dy: dy + (ySnap?.delta ?? 0), lines };
}

export function resizeElement(el: DesignElement, newWidth: number, newHeight: number): DesignElement {
  const width = Number.isFinite(newWidth) ? Math.max(1, newWidth) : 1;
  const height = Number.isFinite(newHeight) ? Math.max(1, newHeight) : 1;
  const baseWidth = Number.isFinite(el.bbox.width) && el.bbox.width > 0 ? el.bbox.width : 1;
  const baseHeight = Number.isFinite(el.bbox.height) && el.bbox.height > 0 ? el.bbox.height : 1;
  const bbox = baseWidth === el.bbox.width && baseHeight === el.bbox.height
    ? el.bbox : { ...el.bbox, width: baseWidth, height: baseHeight };
  return { ...el, bbox, sx: width / baseWidth, sy: height / baseHeight };
}
