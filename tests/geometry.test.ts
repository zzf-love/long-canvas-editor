import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  alignElements, distributeElements, isPageBackground, resizeElement, snapMove, unionBoxes, visualBox,
} from '../src/geometry';
import type { AlignMode, DesignElement, DesignPage } from '../src/types';

function element(id: string, x: number, y: number, width = 100, height = 50,
  extra: Partial<DesignElement> = {}): DesignElement {
  return { id, name: id, type: 'shape', markup: '', bbox: { x, y, width, height },
    tx: 0, ty: 0, sx: 1, sy: 1, locked: false, hidden: false, ...extra };
}
function page(elements: DesignElement[], extra: Partial<DesignPage> = {}): DesignPage {
  return { id: 'p', title: 'Page', width: 790, height: 1240, sourceWidth: 750,
    defs: '', elements, guides: [], ...extra };
}
function byId(value: DesignPage, id: string): DesignElement {
  return value.elements.find(el => el.id === id)!;
}
function close(actual: number, expected: number): void {
  assert.ok(Math.abs(actual - expected) < 1e-8, `${actual} should equal ${expected}`);
}
function frozen<T>(value: T): T {
  if (value && typeof value === 'object') {
    Object.freeze(value);
    for (const child of Object.values(value)) frozen(child);
  }
  return value;
}

test('visual bounds preserve the bounding-box origin when scaling and applying offsets', () => {
  const el = frozen(element('a', 35, 80, 100, 60, { tx: -10, ty: 12, sx: 2, sy: 0.5 }));
  assert.deepEqual(visualBox(el), { x: 25, y: 92, width: 200, height: 30 });
  assert.deepEqual(unionBoxes([visualBox(el), { x: -20, y: 30, width: 10, height: 140 }]),
    { x: -20, y: 30, width: 245, height: 140 });
  assert.deepEqual(unionBoxes([]), { x: 0, y: 0, width: 0, height: 0 });
});

test('all six single-selection alignments use actual 790px page dimensions and scaled sizes', () => {
  const input = frozen(page([element('a', 100, 200, 100, 60, { tx: 5, ty: 8, sx: 1.5, sy: 2 })]));
  const expectations: Record<AlignMode, [number, number]> = {
    left: [0, 208], centerX: [320, 208], right: [640, 208],
    top: [105, 0], centerY: [105, 560], bottom: [105, 1120],
  };
  for (const [mode, [x, y]] of Object.entries(expectations)) {
    const result = alignElements(input, ['a'], mode as AlignMode, 'selection');
    const box = visualBox(result.elements[0]);
    close(box.x, x); close(box.y, y);
    assert.equal(box.width, 150); assert.equal(box.height, 120);
  }
  assert.equal(input.elements[0].tx, 5);
});

test('selection alignment uses eligible visual bounds, ignoring locked, hidden and missing ids', () => {
  const input = frozen(page([
    element('a', 100, 100, 80, 40), element('b', 300, 160, 120, 80, { sx: 1.5 }),
    element('locked', -500, -500, 100, 50, { locked: true }),
    element('hidden', 2000, 2000, 100, 50, { hidden: true }),
  ]));
  const ids = ['a', 'b', 'locked', 'hidden', 'missing'];
  const horizontal = alignElements(input, ids, 'centerX', 'selection');
  const vertical = alignElements(input, ids, 'centerY', 'selection');
  // Original selected union spans x=100..480 and y=100..240.
  for (const id of ['a', 'b']) {
    const xBox = visualBox(byId(horizontal, id));
    const yBox = visualBox(byId(vertical, id));
    close(xBox.x + xBox.width / 2, 290);
    close(yBox.y + yBox.height / 2, 170);
  }
  assert.equal(byId(horizontal, 'locked'), byId(input, 'locked'));
  assert.equal(byId(horizontal, 'hidden'), byId(input, 'hidden'));
  assert.equal(alignElements(input, ['missing', 'locked'], 'left', 'page'), input);
  const singleEligible = alignElements(input, ['a', 'locked'], 'right', 'selection');
  assert.equal(visualBox(byId(singleEligible, 'a')).x, 710);
});

test('horizontal distribution equalizes edge gaps for unequal scaled widths, preserving outer elements', () => {
  const input = frozen(page([
    element('right', 510, 90, 90, 50),
    element('middle', 120, 30, 40, 50, { sx: 2 }),
    element('left', 10, 10, 100, 50),
    element('locked', 200, 10, 50, 50, { locked: true }),
  ]));
  const result = distributeElements(input, ['right', 'locked', 'middle', 'left'], 'x');
  close(visualBox(byId(result, 'middle')).x, 270);
  assert.equal(byId(result, 'left'), byId(input, 'left'));
  assert.equal(byId(result, 'right'), byId(input, 'right'));
  assert.equal(byId(result, 'locked'), byId(input, 'locked'));
  assert.equal(visualBox(byId(result, 'middle')).y, 30);
});

test('vertical distribution handles four elements and existing translations without drift', () => {
  const input = frozen(page([
    element('a', 20, 10, 50, 20, { ty: 10 }),
    element('b', 30, 25, 50, 20, { sy: 2 }),
    element('c', 40, 80, 50, 60),
    element('d', 50, 350, 50, 10, { sy: 2 }),
  ]));
  const result = distributeElements(input, ['a', 'b', 'c', 'd'], 'y');
  const boxes = result.elements.map(visualBox);
  const gaps = boxes.slice(1).map((box, i) => box.y - boxes[i].y - boxes[i].height);
  gaps.forEach(gap => close(gap, 70));
  assert.equal(byId(result, 'a'), byId(input, 'a'));
  assert.equal(byId(result, 'd'), byId(input, 'd'));
  assert.deepEqual(result.elements.map(el => visualBox(el).x), [20, 30, 40, 50]);
});

test('distribution is a no-op with fewer than three eligible elements', () => {
  const input = frozen(page([element('a', 0, 0), element('b', 200, 0), element('c', 300, 0, 10, 10, { hidden: true })]));
  assert.equal(distributeElements(input, ['a', 'b', 'c', 'a'], 'x'), input);
});

test('snap uses manual guides and the doc-unit threshold, changing at most one line per axis', () => {
  const input = frozen(page([element('a', 100, 100, 50, 40)], {
    guides: [{ id: 'gx', axis: 'x', value: 180 }, { id: 'gy', axis: 'y', value: 250 }],
  }));
  assert.deepEqual(snapMove(input, ['a'], 27, 108, 3), {
    dx: 30, dy: 110, lines: [{ axis: 'x', value: 180 }, { axis: 'y', value: 250 }],
  });
  assert.deepEqual(snapMove(input, ['a'], 27, 108, 1), { dx: 27, dy: 108, lines: [] });
});

test('page-center snapping uses 790px width and arbitrary page height', () => {
  const input = frozen(page([element('a', 100, 200, 120, 80)], { height: 980 }));
  assert.deepEqual(snapMove(input, ['a'], 232, 247, 4), {
    dx: 235, dy: 250, lines: [{ axis: 'x', value: 395 }, { axis: 'y', value: 490 }],
  });
});

test('a group snaps its union, preserving internal spacing instead of snapping individual members', () => {
  const input = frozen(page([element('a', 40, 100, 80, 40), element('b', 240, 160, 120, 60)]));
  // Union is x=40..360, y=100..220; moved union center approaches page center.
  const result = snapMove(input, ['a', 'b'], 192, 457, 4);
  assert.deepEqual(result, {
    dx: 195, dy: 460, lines: [{ axis: 'x', value: 395 }, { axis: 'y', value: 620 }],
  });
  close((240 + result.dx) - (40 + result.dx), 200);
});

test('other visible elements provide transformed edge and center targets; locked ones remain targets', () => {
  const input = frozen(page([
    element('a', 100, 100, 50, 40),
    element('target', 285, 380, 100, 60, { tx: 15, ty: 20, sx: 2, sy: 2, locked: true }),
  ]));
  assert.deepEqual(snapMove(input, ['a'], 147, 297, 3), {
    dx: 150, dy: 300, lines: [{ axis: 'x', value: 300 }, { axis: 'y', value: 400 }],
  });
});

test('hidden objects and near-full-page backgrounds do not attract snapping', () => {
  const background = element('bg', 0, 0, 800, 1240, { locked: true });
  const input = frozen(page([
    element('a', 295, 100, 200, 40), background,
    element('hidden', 297, 99, 200, 40, { hidden: true }),
  ]));
  assert.equal(isPageBackground(background, input), true);
  assert.deepEqual(snapMove(input, ['a'], 3, 2, 5), {
    dx: 0, dy: 2, lines: [{ axis: 'x', value: 395 }],
  });
});

test('equally close manual guide wins a tie with the page center', () => {
  const input = frozen(page([element('a', 350, 100, 80, 40)], {
    guides: [{ id: 'manual', axis: 'x', value: 391 }],
  }));
  assert.deepEqual(snapMove(input, ['a'], 3, 0, 2), {
    dx: 1, dy: 0, lines: [{ axis: 'x', value: 391 }],
  });
});

test('snap excludes selected objects, and an immovable or empty selection has no snap lines', () => {
  const input = frozen(page([element('a', 100, 100, 50, 40), element('locked', 300, 300, 50, 40, { locked: true })]));
  assert.deepEqual(snapMove(input, ['a'], 2, 3, 5), { dx: 2, dy: 3, lines: [] });
  assert.deepEqual(snapMove(input, ['locked'], 2, 3, 5), { dx: 2, dy: 3, lines: [] });
  assert.deepEqual(snapMove(input, [], 2, 3, 5), { dx: 2, dy: 3, lines: [] });
});

test('resize targets visual dimensions, preserves the top-left anchor, and clamps to one unit', () => {
  const original = frozen(element('a', 20, 30, 100, 80, { tx: 7, ty: -5, sx: 2, sy: 0.5 }));
  const resized = resizeElement(original, 240, 120);
  assert.deepEqual(visualBox(resized), { x: 27, y: 25, width: 240, height: 120 });
  assert.equal(resized.bbox, original.bbox);
  assert.deepEqual(visualBox(resizeElement(original, 0, -20)), { x: 27, y: 25, width: 1, height: 1 });
  assert.equal(original.sx, 2);
  const degenerate = frozen(element('empty', 10, 20, 0, 0));
  assert.deepEqual(visualBox(resizeElement(degenerate, 120, 40)), { x: 10, y: 20, width: 120, height: 40 });
});
