import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import {
  applyFlatTransforms, decodeElementKey, elementKey, flattenProject, LONG_BACKGROUND_ID,
  pageOffsets, relocateElements, relocateElementsWithSelection,
} from '../src/longLayout';
import { visualBox } from '../src/geometry';
import type { DesignElement, DesignPage, Project } from '../src/types';

let passed = 0;
function test(name: string, fn: () => void) { fn(); passed += 1; console.log(`PASS ${name}`); }
function near(actual: number, expected: number) { assert.ok(Math.abs(actual - expected) < 1e-6, `${actual} != ${expected}`); }
const shape = (id = 'shape', props: Partial<DesignElement> = {}): DesignElement => ({
  id, name: id, type: 'shape', markup: '<rect x="10" y="20" width="30" height="40" fill="url(#fade)"/>',
  bbox: { x: 10, y: 20, width: 30, height: 40 }, tx: 0, ty: 0, sx: 1, sy: 1, locked: false, hidden: false, ...props,
});
function page(id: string, elements: DesignElement[], sourceWidth = 790, height = 100): DesignPage {
  return { id, title: id, width: 790, sourceWidth, height, defs: `<linearGradient id="fade"><stop stop-color="${id === 'a' ? '#000' : '#fff'}"/></linearGradient>`, elements, guides: [] };
}
function project(pages = [page('a', [shape()]), page('b', [])]): Project {
  return { schemaVersion: 1, id: 'test', title: 'test', width: 790, updatedAt: '2026-09-18', pages, assets: {} };
}
type Point = { x: number; y: number };
function applyTransform(point: Point, transform: string): Point {
  const operations = [...transform.matchAll(/(translate|scale)\(([^)]+)\)/g)].reverse();
  return operations.reduce((result, operation) => {
    const values = operation[2].trim().split(/[ ,]+/).map(Number);
    return operation[1] === 'translate'
      ? { x: result.x + values[0], y: result.y + (values[1] ?? 0) }
      : { x: result.x * values[0], y: result.y * (values[1] ?? values[0]) };
  }, point);
}
/** Read wrapper transforms to verify actual SVG geometry, not just bookkeeping bbox values. */
function worldPoint(item: DesignElement, owner: DesignPage, top: number, point: Point): Point {
  const wrappers = [...item.markup.split('<rect')[0].matchAll(/<g[^>]*transform="([^"]+)"/g)].reverse();
  let result = wrappers.reduce((current, match) => applyTransform(current, match[1]), point);
  const scale = 790 / owner.sourceWidth;
  result = { x: result.x * scale, y: result.y * scale };
  return {
    x: item.bbox.x + (result.x - item.bbox.x) * item.sx + item.tx,
    y: top + item.bbox.y + (result.y - item.bbox.y) * item.sy + item.ty,
  };
}
function expectMovedGeometry(before: Project, after: Project, key: string, selected: string, dx: number, dy: number) {
  const oldIds = decodeElementKey(key)!; const newIds = decodeElementKey(selected)!;
  const source = pageOffsets(before).find(({ page }) => page.id === oldIds.pageId)!;
  const target = pageOffsets(after).find(({ page }) => page.id === newIds.pageId)!;
  const original = source.page.elements.find(item => item.id === oldIds.elementId)!;
  const moved = target.page.elements.find(item => item.id === newIds.elementId)!;
  for (const point of [{ x: 10, y: 20 }, { x: 40, y: 60 }, { x: 17, y: 31 }]) {
    const from = worldPoint(original, source.page, source.top, point);
    const to = worldPoint(moved, target.page, target.top, point);
    near(to.x, from.x + dx); near(to.y, from.y + dy);
  }
}

test('Offsets follow current module order and variable heights', () => {
  const p = project([page('b', [], 750, 1306), page('a', [], 790, 800)]);
  assert.deepEqual(pageOffsets(p).map(({ page, top, index }) => [page.id, top, index]), [['b', 0, 0], ['a', 1306, 1]]);
});
test('Keys safely distinguish delimiter, quotation, and Unicode IDs', () => {
  assert.notEqual(elementKey('a/b', 'c'), elementKey('a', 'b/c'));
  const key = elementKey('页["一"]', '元素/🔷');
  assert.deepEqual(decodeElementKey(key), { pageId: '页["一"]', elementId: '元素/🔷' });
  assert.equal(decodeElementKey('bad'), null); assert.equal(decodeElementKey('[1,2]'), null);
  assert.equal(decodeElementKey('["a","b","c"]'), null);
});
test('Flatten synthesizes a white locked base and separates all backgrounds from foreground', () => {
  const background = shape('bg', { locked: true, bbox: { x: 0, y: 0, width: 790, height: 100 } });
  const p = project([page('a', [background, shape('a')]), page('b', [background, shape('b')])]);
  const flat = flattenProject(p);
  assert.equal(flat.elements[0].id, LONG_BACKGROUND_ID);
  assert.equal(flat.elements[0].locked, true);
  assert.deepEqual(flat.elements.slice(1).map(item => item.id), [elementKey('a', 'bg'), elementKey('b', 'bg'), elementKey('a', 'a'), elementKey('b', 'b')]);
  assert.match(flat.elements[1].markup, /clip-path="url\(#long-canvas-page-clip-0\)"/);
  assert.doesNotMatch(flat.elements[3].markup, /clip-path/);
  assert.equal(flat.width, 790); assert.equal(flat.sourceWidth, 790); assert.equal(flat.height, 200);
});
test('Unlocked full-module artwork remains editable foreground', () => {
  const p = project([page('a', [shape('full', { bbox: { x: 0, y: 0, width: 790, height: 100 } })])]);
  assert.doesNotMatch(flattenProject(p).elements[1].markup, /clip-path/);
});
test('Paint definitions are page-scoped together with references', () => {
  const flat = flattenProject(project([page('a', [shape()]), page('b', [shape()])]));
  assert.match(flat.defs, /id="p-a-fade"/); assert.match(flat.defs, /id="p-b-fade"/);
  assert.match(flat.elements.find(item => item.id === elementKey('a', 'shape'))!.markup, /url\(#p-a-fade\)/);
  assert.match(flat.elements.find(item => item.id === elementKey('b', 'shape'))!.markup, /url\(#p-b-fade\)/);
});
test('Flatten preserves geometry for scaled and translated artwork from a 750px page', () => {
  const item = shape('shape', { bbox: { x: 10 * 790 / 750, y: 20 * 790 / 750, width: 30 * 790 / 750, height: 40 * 790 / 750 }, tx: 14, ty: -8, sx: 1.7, sy: .6 });
  const p = project([page('a', []), page('b', [item], 750)]);
  const flat = flattenProject(p); const flattened = flat.elements.find(el => el.id === elementKey('b', item.id))!;
  const expected = worldPoint(item, p.pages[1], 100, { x: 40, y: 60 });
  const actual = worldPoint(flattened, flat, 0, { x: 40, y: 60 });
  near(actual.x, expected.x); near(actual.y, expected.y);
  assert.equal(flattened.bbox.y, item.bbox.y + 100);
});
test('Horizontal guides gain module offset; vertical guides retain X', () => {
  const p = project(); p.pages[1].guides = [{ id: 'horizontal', axis: 'y', value: 20 }, { id: 'vertical', axis: 'x', value: 40 }];
  assert.deepEqual(flattenProject(p).guides, [{ id: elementKey('b', 'horizontal'), axis: 'y', value: 120 }, { id: elementKey('b', 'vertical'), axis: 'x', value: 40 }]);
});
test('Unchanged flattened transforms return original project and metadata', () => {
  const p = project([page('a', []), page('b', [shape('test', { bbox: { x: 4.125, y: 17.2935, width: 25.877, height: 3.3 } })])]);
  assert.equal(applyFlatTransforms(p, flattenProject(p)), p);
});
test('Applying global geometry writes only local geometry and preserves source markup', () => {
  const p = project([page('a', []), page('b', [shape()])]); const flat = flattenProject(p);
  const item = flat.elements.find(el => el.id === elementKey('b', 'shape'))!;
  item.bbox.y += 10; item.tx = 55; item.sy = 1.6; item.markup = 'DO NOT PERSIST';
  const result = applyFlatTransforms(p, flat);
  assert.equal(result.pages[1].elements[0].bbox.y, 30); assert.equal(result.pages[1].elements[0].tx, 55);
  assert.equal(result.pages[1].elements[0].sy, 1.6);
  assert.equal(result.pages[1].elements[0].markup, p.pages[1].elements[0].markup);
  assert.equal(result.pages[0], p.pages[0]); assert.equal(result.assets, p.assets);
});
test('Drag previews move globally without transferring ownership or definitions', () => {
  const p = project(); const result = relocateElements(p, [elementKey('a', 'shape')], 7, 170, false);
  assert.equal(result.pages[0].elements[0].ty, 170); assert.equal(result.pages[0].elements[0].tx, 7);
  assert.equal(result.pages[1], p.pages[1]); assert.equal(result.pages[0].elements[0].markup, p.pages[0].elements[0].markup);
  assert.equal(result.pages[0].defs, p.pages[0].defs);
});
test('Cross-module drop preserves actual transformed SVG positions and namespaces', () => {
  const p = project([page('a', [shape('shape', { tx: 8, ty: 9, sx: 1.5, sy: .7 })]), page('b', [])]);
  const key = elementKey('a', 'shape'); const result = relocateElementsWithSelection(p, [key], 13, 120);
  assert.equal(result.project.pages[0].elements.length, 0); assert.equal(result.project.pages[1].elements.length, 1);
  assert.equal(result.selected[0], elementKey('b', 'shape'));
  expectMovedGeometry(p, result.project, key, result.selected[0], 13, 120);
  const reference = result.project.pages[1].elements[0].markup.match(/url\(#([^)]+)\)/)![1];
  assert.ok(result.project.pages[1].defs.includes(`id="${reference}"`)); assert.notEqual(reference, 'fade');
});
test('750px to 790px ownership transfer keeps physical size', () => {
  const scale = 790 / 750;
  const p = project([page('a', [shape('shape', { bbox: { x: 10 * scale, y: 20 * scale, width: 30 * scale, height: 40 * scale }, sx: .8, sy: 1.4 })], 750), page('b', [], 790)]);
  const key = elementKey('a', 'shape'); const result = relocateElementsWithSelection(p, [key], 2, 100);
  expectMovedGeometry(p, result.project, key, result.selected[0], 2, 100);
  near(visualBox(result.project.pages[1].elements[0]).width, visualBox(p.pages[0].elements[0]).width);
});
test('790px to 750px and back remains stable, including copied paint references', () => {
  const p = project([page('a', [], 750), page('b', [shape('shape', { tx: 5, ty: 6, sx: 1.2, sy: 1.8 })], 790)]);
  const key = elementKey('b', 'shape'); const first = relocateElementsWithSelection(p, [key], 10, -100);
  expectMovedGeometry(p, first.project, key, first.selected[0], 10, -100);
  const second = relocateElementsWithSelection(first.project, first.selected, -10, 100);
  expectMovedGeometry(first.project, second.project, first.selected[0], second.selected[0], -10, 100);
  const moved = second.project.pages[1].elements[0];
  const reference = moved.markup.match(/url\(#([^)]+)\)/)![1];
  assert.ok(second.project.pages[1].defs.includes(`id="${reference}"`));
});
test('Multi-selection can land in separate modules and keeps selection ordering', () => {
  const p = project([page('a', [shape('first'), shape('second', { ty: 65 })]), page('b', []), page('c', [])]);
  const keys = [elementKey('a', 'second'), elementKey('a', 'first')];
  const result = relocateElementsWithSelection(p, keys, 0, 100);
  assert.deepEqual(result.selected, [elementKey('c', 'second'), elementKey('b', 'first')]);
  assert.equal(result.project.pages[1].elements[0].id, 'first'); assert.equal(result.project.pages[2].elements[0].id, 'second');
});
test('Locked and hidden layers do not move; out-of-range centers clamp to edge modules', () => {
  const p = project([page('a', [shape('locked', { locked: true }), shape('hidden', { hidden: true })]), page('b', [shape('move')])]);
  const keys = [elementKey('a', 'locked'), elementKey('a', 'hidden'), elementKey('b', 'move')];
  const result = relocateElements(p, keys, 0, -10000);
  assert.equal(result.pages[0].elements[0], p.pages[0].elements[0]); assert.equal(result.pages[0].elements[1], p.pages[0].elements[1]);
  assert.equal(result.pages[0].elements[2].id, 'move');
  const movedBack = relocateElements(result, [elementKey('a', 'move')], 0, 20000);
  assert.equal(movedBack.pages[1].elements[0].id, 'move');
});
test('An exact module boundary assigns to the following module', () => {
  const p = project(); const result = relocateElementsWithSelection(p, [elementKey('a', 'shape')], 0, 60);
  assert.equal(result.selected[0], elementKey('b', 'shape'));
});
test('Conflicting element IDs get a deterministic fresh ID and usable selection', () => {
  const p = project([page('a', [shape()]), page('b', [shape()])]);
  const result = relocateElementsWithSelection(p, [elementKey('a', 'shape')], 0, 100);
  assert.equal(result.selected[0], elementKey('b', 'shape-from-a'));
  assert.equal(new Set(result.project.pages[1].elements.map(el => el.id)).size, 2);
  expectMovedGeometry(p, result.project, elementKey('a', 'shape'), result.selected[0], 0, 100);
});
test('No-op, invalid movement, and missing keys preserve project identity', () => {
  const p = project(); assert.equal(relocateElements(p, [elementKey('a', 'shape')], 0, 0), p);
  assert.equal(relocateElements(p, [elementKey('a', 'shape')], NaN, 2), p);
  assert.equal(relocateElements(p, ['missing'], 20, 30), p);
});
test('Conflict resolution retains valid metadata ID length for imported long IDs', () => {
  const longId = 'x'.repeat(128); const sourceId = 'source'.repeat(20);
  const p = project([page(sourceId, [shape(longId)]), page('b', [shape(longId)])]);
  const result = relocateElementsWithSelection(p, [elementKey(sourceId, longId)], 0, 100);
  const id = decodeElementKey(result.selected[0])!.elementId;
  assert.ok(id.length <= 128); assert.notEqual(id, longId);
});
test('Inputs remain unchanged when moving multiple elements', () => {
  const p = project([page('a', [shape('one'), shape('two')]), page('b', [])]);
  const original = JSON.stringify(p);
  relocateElements(p, [elementKey('a', 'one'), elementKey('a', 'two')], 7, 110);
  assert.equal(JSON.stringify(p), original);
});
test('Transfers retain paint dependency chains without copying unrelated definitions', () => {
  const p = project();
  p.pages[0].defs = '<linearGradient id="base"><stop offset="0" stop-color="#ff0"/></linearGradient><linearGradient id="fade" href="#base"/><filter id="unused"><feGaussianBlur stdDeviation="5"/></filter>';
  const moved = relocateElements(p, [elementKey('a', 'shape')], 0, 100);
  const defs = moved.pages[1].defs;
  assert.match(defs, /-base"/); assert.match(defs, /href="#p-move-.*-base"/);
  assert.doesNotMatch(defs, /unused|feGaussianBlur/);
});
test('Repeated cross-module moves do not exponentially duplicate the definitions library', () => {
  let p = project(); let selected = [elementKey('a', 'shape')];
  for (let index = 0; index < 20; index += 1) {
    const next = relocateElementsWithSelection(p, selected, 0, index % 2 === 0 ? 100 : -100);
    p = next.project; selected = next.selected;
  }
  assert.ok(p.pages.reduce((total, item) => total + item.defs.length, 0) < 100_000);
  const ids = decodeElementKey(selected[0])!;
  const owner = p.pages.find(item => item.id === ids.pageId)!;
  const moved = owner.elements.find(item => item.id === ids.elementId)!;
  const reference = moved.markup.match(/url\(#([^)]+)\)/)![1];
  assert.ok(owner.defs.includes(`id="${reference}"`));
});
test('Three-section example flattens at 790px and retains editable vector layers', () => {
  const path = fileURLToPath(new URL('../public/seed-project.json', import.meta.url));
  const seed = JSON.parse(readFileSync(path, 'utf8')) as Project;
  const flat = flattenProject(seed);
  assert.equal(seed.pages.length, 3); assert.equal(flat.height, seed.pages.reduce((sum, item) => sum + item.height, 0));
  assert.equal(flat.elements.length, seed.pages.reduce((sum, item) => sum + item.elements.length, 0) + 1);
  assert.ok(flat.elements.some(item => item.type === 'text'));
  assert.ok(flat.elements.some(item => item.markup.includes('url(#')));
  assert.equal(Object.keys(seed.assets).length, 0);
  assert.ok(flat.elements.every(item => !item.markup.includes('base64,')));
  assert.equal(applyFlatTransforms(seed, flat), seed);
});
console.log(`\n${passed} long-layout tests passed.`);
