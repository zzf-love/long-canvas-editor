import assert from 'node:assert/strict';
import { expandLinkedSelection, linkElements, unlinkElements, reorderLayers, moveLayerTo } from '../src/layers';
import { elementKey, flattenProject, relocateElementsWithSelection } from '../src/longLayout';
import { validateProject } from '../src/projectIO';
import { readEditorFile } from '../src/pageUpdate';
import type { DesignElement, DesignPage, Project } from '../src/types';

const layer = (id: string, fields: Partial<DesignElement> = {}): DesignElement => ({
  id, name: id, type: 'shape', markup: '', bbox: { x: 10, y: 10, width: 20, height: 20 },
  tx: 0, ty: 0, sx: 1, sy: 1, locked: false, hidden: false, ...fields,
});
const page = (id: string, elements: DesignElement[]): DesignPage => ({
  id, title: id, width: 790, height: 1000, sourceWidth: 790, defs: '', elements, guides: [],
});
const project = (...pages: DesignPage[]): Project => ({
  schemaVersion: 1, id: 'layers-test', title: '图层验证', width: 790,
  updatedAt: '2026-09-19T00:00:00Z', assets: {}, pages,
});
const key = (id: string, pageId = 'p1') => elementKey(pageId, id);
const order = (value: Project, index = 0) => value.pages[index].elements.map(element => element.id);
const links = (value: Project) => value.pages.flatMap(page => page.elements.map(element => element.linkId));

const linkedFixture = project(
  page('p1', [layer('a', { linkId: 'one' }), layer('b', { linkId: 'one', hidden: true }),
    layer('c', { linkId: 'two' }), layer('d'), layer('locked', { locked: true })]),
  page('p2', [layer('e', { linkId: 'one' }), layer('f', { linkId: 'two', locked: true })]),
);
const fixtureSnapshot = JSON.stringify(linkedFixture);
assert.deepEqual(expandLinkedSelection(linkedFixture, [key('a'), key('a'), 'missing']), [key('a'), key('e', 'p2')]);
assert.deepEqual(expandLinkedSelection(linkedFixture, [key('b')]), [key('b'), key('a'), key('e', 'p2')]);
assert.deepEqual(expandLinkedSelection(linkedFixture, [key('f', 'p2')]), [key('f', 'p2'), key('c')]);

const merged = linkElements(linkedFixture, [key('a'), key('c')], 'merged');
assert.deepEqual(links(merged), ['merged', 'merged', 'merged', undefined, undefined, 'merged', 'merged']);
assert.equal(merged.pages[0].elements[3], linkedFixture.pages[0].elements[3]);
assert.equal(linkElements(merged, [key('a'), key('c')], 'merged'), merged, 'Same association is a no-op');
assert.equal(linkElements(linkedFixture, [key('d')], 'singleton'), linkedFixture, 'Do not create singleton groups');
assert.equal(linkElements(linkedFixture, [key('b'), key('locked')], 'blocked'), linkedFixture, 'New direct associations exclude hidden/locked objects');
assert.throws(() => linkElements(linkedFixture, [key('a'), key('d')], 'bad\nlink'), /标识/);

const unlinked = unlinkElements(merged, [key('a')]);
assert.deepEqual(links(unlinked), [undefined, undefined, undefined, undefined, undefined, undefined, undefined]);
assert.equal(Object.prototype.hasOwnProperty.call(unlinked.pages[0].elements[0], 'linkId'), false);
assert.equal(unlinkElements(linkedFixture, [key('d')]), linkedFixture);
assert.equal(JSON.stringify(linkedFixture), fixtureSnapshot, 'Model operations do not mutate the input');

const transferred = relocateElementsWithSelection(merged, expandLinkedSelection(merged, [key('a')]), 0, 1200);
assert.equal(transferred.project.pages[1].elements.find(element => element.id === 'a')?.linkId, 'merged');
assert.equal(transferred.project.pages[0].elements.find(element => element.id === 'b')?.linkId, 'merged');
assert.equal(transferred.project.pages[1].elements.find(element => element.id === 'f')?.ty, 0, 'Locked peers stay put during transfer');
assert.equal(transferred.project.pages[0].elements.find(element => element.id === 'b')?.ty, 0, 'Hidden peers stay put during transfer');

const ordering = project(page('p1', ['a', 'b', 'c', 'd', 'e'].map(id => layer(id))), page('p2', ['a', 'b', 'c'].map(id => layer(id))));
assert.deepEqual(order(reorderLayers(ordering, [key('b'), key('c')], 'up')), ['a', 'd', 'b', 'c', 'e']);
assert.deepEqual(order(reorderLayers(ordering, [key('b'), key('d')], 'up')), ['a', 'c', 'b', 'e', 'd']);
assert.deepEqual(order(reorderLayers(ordering, [key('b'), key('c')], 'down')), ['b', 'c', 'a', 'd', 'e']);
assert.deepEqual(order(reorderLayers(ordering, [key('b'), key('d')], 'down')), ['b', 'a', 'd', 'c', 'e']);
assert.deepEqual(order(reorderLayers(ordering, [key('b'), key('d')], 'front')), ['a', 'c', 'e', 'b', 'd']);
assert.deepEqual(order(reorderLayers(ordering, [key('b'), key('d')], 'back')), ['b', 'd', 'a', 'c', 'e']);
assert.equal(reorderLayers(ordering, [key('e')], 'up'), ordering);
assert.equal(reorderLayers(ordering, [key('a')], 'down'), ordering);
assert.equal(reorderLayers(ordering, ['missing'], 'front'), ordering);
const across = reorderLayers(ordering, [key('a'), key('a', 'p2')], 'front');
assert.deepEqual(order(across), ['b', 'c', 'd', 'e', 'a']);
assert.deepEqual(order(across, 1), ['b', 'c', 'a']);

const backdrop = layer('bg', { locked: true, bbox: { x: 0, y: 0, width: 790, height: 1000 } });
const fixedBackground = project(page('p1', [layer('a'), backdrop, layer('lock', { locked: true }), layer('b'), layer('hidden', { hidden: true })]));
const sentBack = reorderLayers(fixedBackground, [key('b')], 'back');
assert.deepEqual(order(sentBack), ['b', 'bg', 'a', 'lock', 'hidden']);
assert.equal(sentBack.pages[0].elements[1], backdrop, 'Backdrop metadata slot remains intact');
assert.deepEqual(flattenProject(sentBack).elements.slice(1).map(element => JSON.parse(element.id)[1]), ['bg', 'b', 'a', 'lock', 'hidden']);
assert.equal(reorderLayers(fixedBackground, [key('bg'), key('lock')], 'front'), fixedBackground);
assert.equal(reorderLayers(fixedBackground, [key('a')], 'back'), fixedBackground, 'A normal layer cannot move below backdrop');
assert.deepEqual(order(reorderLayers(fixedBackground, [key('hidden')], 'back')), ['hidden', 'bg', 'a', 'lock', 'b']);

assert.deepEqual(order(moveLayerTo(ordering, 'p1', ['b', 'd'], 'e', 'after')), ['a', 'c', 'e', 'b', 'd']);
assert.deepEqual(order(moveLayerTo(ordering, 'p1', ['d', 'b'], 'a', 'before')), ['b', 'd', 'a', 'c', 'e'], 'Input selection order never reverses visual order');
assert.equal(moveLayerTo(ordering, 'p1', ['b', 'd'], 'b', 'after'), ordering);
assert.equal(moveLayerTo(ordering, 'p1', ['a'], 'missing', 'before'), ordering);
assert.equal(moveLayerTo(fixedBackground, 'p1', ['a'], 'bg', 'before'), fixedBackground);
assert.equal(moveLayerTo(fixedBackground, 'p1', ['bg', 'lock'], 'a', 'after'), fixedBackground);
assert.equal(moveLayerTo(ordering, 'p1', ['b'], 'a', 'after'), ordering, 'Already-adjacent drop is a no-op');

// Metadata compatibility does not need SVG parsing. This deliberately narrow stand-in
// accepts only empty SVG fixtures; the real browser's existing sanitizer remains intact.
Object.assign(globalThis, {
  DOMParser: class {
    parseFromString(source: string) {
      assert.equal(source, '<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink"></svg>');
      return { getElementsByTagName: () => [], documentElement: { childNodes: [] } };
    }
  },
  XMLSerializer: class { serializeToString() { throw new Error('Empty fixture must not serialize SVG nodes'); } },
});
const oldProject = project(page('p1', [layer('old')]));
const oldRead = validateProject(JSON.parse(JSON.stringify(oldProject)));
assert.equal('linkId' in oldRead.pages[0].elements[0], false, 'Legacy projects omit link metadata');
assert.deepEqual(links(validateProject(JSON.parse(JSON.stringify(merged)))), links(merged), 'Linked associations survive file round-trip');
for (const invalid of ['', ' '.repeat(2), '\u0000bad', 'x'.repeat(129), null, 123, {}]) {
  const input = JSON.parse(JSON.stringify(oldProject));
  input.pages[0].elements[0].linkId = invalid;
  assert.throws(() => validateProject(input), /链接标识/);
}
const revision = {
  kind: 'long-canvas-page-update', schemaVersion: 1, targetProjectId: oldProject.id,
  pageId: 'p1', sourceWidth: 790, title: 'Scoped test', removeElementIds: [],
  assets: {}, elements: [layer('a', { linkId: 'linked-update' }), layer('b', { linkId: 'linked-update' })],
};
const revisionRead = await readEditorFile(new File([JSON.stringify(revision)], 'linked.json'));
assert.ok('kind' in revisionRead);
assert.deepEqual(revisionRead.elements.map(element => element.linkId), ['linked-update', 'linked-update']);
const invalidRevision = { ...revision, elements: [layer('a', { linkId: '\n' })] };
await assert.rejects(readEditorFile(new File([JSON.stringify(invalidRevision)], 'invalid.json')), /链接标识/);
console.log('PASS: linked selection, complete group merge/unlink, immutable changes, cross-section transfer, stable multi-layer order, boundaries/backdrops, drag order and project/update metadata compatibility.');
