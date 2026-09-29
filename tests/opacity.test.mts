import assert from 'node:assert/strict';
import {test} from 'node:test';
import {createRequire} from 'node:module';
import Artwork from '../src/Artwork';
import {renderPageSvg} from '../src/svg';
import {flattenProject} from '../src/longLayout';
import {validateProject} from '../src/projectIO';
import {applyPageUpdate, readEditorFile} from '../src/pageUpdate';
import type {PageUpdate} from '../src/pageUpdate';
import type {DesignElement, Project} from '../src/types';

const require = createRequire(import.meta.url);
const {createElement} = require('react');
const {renderToStaticMarkup} = require('react-dom/server');
const sharp = createRequire(import.meta.url)('sharp');

function layer(id: string, extra: Partial<DesignElement> = {}): DesignElement {
  return {id, name: id, type: 'group', markup: '', bbox: {x: 0, y: 0, width: 100, height: 100},
    tx: 0, ty: 0, sx: 1, sy: 1, locked: false, hidden: false, ...extra};
}
function project(elements: DesignElement[], defs = ''): Project {
  return {schemaVersion: 1, id: 'opacity-test', title: 'Opacity', width: 790,
    updatedAt: '2026-09-19T04:00:00.000Z', assets: {}, pages: [{id: 'page-1', title: 'Page',
      width: 790, height: 100, sourceWidth: 790, defs, elements, guides: []}]};
}
const background = layer('background', {type: 'shape', locked: true,
  bbox: {x: 0, y: 0, width: 790, height: 100}, markup: '<rect width="790" height="100" fill="#fff"/>'});
async function pixels(svg: string) {
  return sharp(Buffer.from(svg)).ensureAlpha().raw().toBuffer({resolveWithObject: true});
}
function rgba(image: any, x: number, y: number): number[] {
  const offset = (y * image.info.width + x) * 4;
  return [...image.data.subarray(offset, offset + 4)];
}
function near(actual: number[], expected: number[]) {
  actual.forEach((value, index) => assert.ok(Math.abs(value - expected[index]) <= 1, `${actual} differs from ${expected}`));
}

test('0, .5, 1 and omitted opacity match in editor artwork, preview composition and SVG/PNG renderer', async () => {
  const markup = '<rect x="10" y="10" width="50" height="60" fill="#f00"/><rect x="40" y="10" width="50" height="60" fill="#00f"/>';
  for (const opacity of [undefined, 0, 0.5, 1]) {
    const subject = layer('overlap', {markup, ...(opacity === undefined ? {} : {opacity})});
    const fixture = project([background, subject]);
    const before = JSON.stringify(fixture);
    const output = renderPageSvg(fixture, fixture.pages[0]);
    const expected = await pixels(output);
    const artwork = await pixels(renderToStaticMarkup(createElement(Artwork, {project: fixture, page: fixture.pages[0]})));
    const preview = await pixels(renderToStaticMarkup(createElement(Artwork, {project: fixture, page: flattenProject(fixture)})));
    assert.deepEqual(artwork.data, expected.data);
    assert.deepEqual(preview.data, expected.data);
    const alpha = opacity ?? 1;
    near(rgba(expected, 20, 20), [255, 255 * (1 - alpha), 255 * (1 - alpha), 255]);
    near(rgba(expected, 50, 20), [255 * (1 - alpha), 255 * (1 - alpha), 255, 255]);
    // The overlap must have the same alpha as the blue-only region: children composite once.
    assert.deepEqual(rgba(expected, 50, 20), rgba(expected, 80, 20));
    assert.equal(JSON.stringify(fixture), before);
    assert.equal(subject.markup, markup);
    if (opacity === undefined) assert.doesNotMatch(output, / opacity=/);
    else assert.match(output, new RegExp(` opacity="${opacity}"`));
  }
});

test('layer opacity multiplies existing nested alpha and gradients without rewriting artwork', async () => {
  const defs = '<linearGradient id="fade" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="#001b4d" stop-opacity=".2"/><stop offset="1" stop-color="#001b4d" stop-opacity=".8"/></linearGradient>';
  const markup = '<g opacity=".6"><rect width="100" height="80" fill="url(#fade)"/></g>';
  const full = project([background, layer('gradient', {markup})], defs);
  const half = project([background, layer('gradient', {markup, opacity: 0.5})], defs);
  const original = await pixels(renderPageSvg(full, full.pages[0]));
  const faded = await pixels(renderPageSvg(half, half.pages[0]));
  for (const x of [10, 50, 90]) {
    near(rgba(faded, x, 20), rgba(original, x, 20).map((value, i) => i === 3 ? 255 : (value + 255) / 2));
  }
  assert.equal(half.pages[0].elements[1].markup, markup);
  assert.equal(half.pages[0].defs, defs);
});

// Metadata validation needs no SVG nodes. This narrow stand-in only accepts empty SVG,
// leaving real SVG sanitization to browser integration (and real rendering tests above).
Object.assign(globalThis, {
  DOMParser: class {
    parseFromString(source: string) {
      assert.equal(source, '<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink"></svg>');
      return {getElementsByTagName: () => [], documentElement: {childNodes: []}};
    }
  },
  XMLSerializer: class {serializeToString() {throw new Error('Empty fixture cannot contain SVG nodes');}},
});

test('optional opacity roundtrips without changing legacy schema or adding default metadata', () => {
  for (const opacity of [undefined, 0, 0.5, 1]) {
    const fixture = project([layer('subject', opacity === undefined ? {} : {opacity})]);
    const restored = validateProject(JSON.parse(JSON.stringify(fixture)));
    assert.equal(restored.pages[0].elements[0].opacity, opacity);
    assert.equal('opacity' in restored.pages[0].elements[0], opacity !== undefined);
    assert.deepEqual(JSON.parse(JSON.stringify(restored)), JSON.parse(JSON.stringify(fixture)));
  }
});

test('non-numeric, non-finite and out-of-range opacity is rejected at the import boundary', async () => {
  for (const opacity of [-1, -0.001, 1.001, 2, NaN, Infinity, -Infinity, null, '0.5', true, {}, []]) {
    const fixture = project([layer('subject')]);
    (fixture.pages[0].elements[0] as any).opacity = opacity;
    assert.throws(() => validateProject(fixture), /图层不透明度/);
    const revision = patch(fixture.pages[0].elements);
    await assert.rejects(readEditorFile(new File([JSON.stringify(revision)], 'invalid.json')), /图层不透明度/);
  }
});

function patch(elements: DesignElement[]): PageUpdate {
  return {kind: 'long-canvas-page-update', schemaVersion: 1, targetProjectId: 'opacity-test', pageId: 'page-1',
    sourceWidth: 790, title: 'Scoped opacity', removeElementIds: [], elements, assets: {}, preserveLayerOrder: true};
}

test('scoped updates retain existing opacity when omitted and respect explicit 0 / 1', async () => {
  for (const existing of [undefined, 0, 0.5, 1]) {
    const untouched = layer('untouched', {opacity: 0.3});
    const fixture = project([layer('subject', {...(existing === undefined ? {} : {opacity: existing}), linkId: 'linked'}), untouched]);
    for (const incoming of [undefined, 0, 0.5, 1]) {
      const raw = patch([layer('subject', incoming === undefined ? {} : {opacity: incoming})]);
      const parsed = await readEditorFile(new File([JSON.stringify(raw)], 'patch.json'));
      assert.ok('kind' in parsed);
      const result = applyPageUpdate(fixture, parsed);
      assert.equal(result.pages[0].elements[0].opacity, incoming ?? existing);
      assert.equal(result.pages[0].elements[0].linkId, 'linked');
      assert.equal(result.pages[0].elements[1], untouched);
      assert.deepEqual(applyPageUpdate(result, parsed), result);
      if (incoming === undefined && existing === undefined) assert.equal('opacity' in result.pages[0].elements[0], false);
    }
  }
});
