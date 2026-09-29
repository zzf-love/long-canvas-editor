import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { MAX_SECTION_HEIGHT, MIN_SECTION_HEIGHT, normalizeSectionHeight, resizeSection } from '../src/sectionResize';
import { flattenProject, pageOffsets, elementKey } from '../src/longLayout';
import { isPageBackground, visualBox } from '../src/geometry';
import { renderPageSvg } from '../src/svg';
import type { DesignElement, DesignPage, Project } from '../src/types';
let passed = 0;
function test(name: string, fn: () => void) { fn(); passed++; console.log(`PASS ${name}`); }
function near(actual: number, expected: number) { assert.ok(Math.abs(actual - expected) < 1e-6, `${actual} != ${expected}`); }
const shape = (id = 'shape', props: Partial<DesignElement> = {}): DesignElement => ({
  id, name: id, type: 'shape', markup: '<rect x="10" y="20" width="30" height="40" fill="#fff"/>',
  bbox: { x: 10, y: 20, width: 30, height: 40 }, tx: 0, ty: 0, sx: 1, sy: 1, locked: false, hidden: false, ...props,
});
function page(id: string, height = 1000): DesignPage {
  return { id, title: id, width: 790, sourceWidth: 790, height, defs: '', elements: [
    shape('background', { locked: true, markup: `<rect width="790" height="${height}" fill="#123456"/>`, bbox: { x: 0, y: 0, width: 790, height } }),
    shape('text', { type: 'text', markup: '<text x="12" y="44">文字</text>' }),
    shape('product', { type: 'image', markup: '<image x="10" y="20" width="30" height="40" href="asset:product"/>' }),
  ], guides: [{ id: 'horizontal', axis: 'y', value: 123 }, { id: 'vertical', axis: 'x', value: 45 }] };
}
function project(pages = [page('a'), page('b'), page('c')]): Project {
  return { schemaVersion: 1, id: 'test', title: 'test', width: 790, updatedAt: '2026-09-18', pages, assets: {} };
}
function attr(markup: string, name: string) { return markup.match(new RegExp(`\\s${name}="([^"]+)"`))?.[1]; }
// Synthetic legacy-width fixture: exercise crop math without customer artwork.
const factor = 790 / 750;
const seed = project([
  { ...page('page-01', 1306), sourceWidth: 750, elements: [shape('overscan', {
    type: 'image', locked: true,
    markup: '<image x="-75" y="-30" width="900" height="1488" href="asset:test-pixel" preserveAspectRatio="xMidYMid slice"/>',
    bbox: { x: -79, y: -30 * factor, width: 948, height: 1488 * factor },
  })] },
  { ...page('page-02', 1100), sourceWidth: 750, elements: [shape('background', {
    locked: true, markup: `<rect width="750" height="${1100 / factor}" fill="#123456"/>`,
    bbox: { x: 0, y: 0, width: 790, height: 1100 },
  })] },
  { ...page('page-03', 1180), elements: [
    shape('background', { locked: true, markup: '<rect width="790" height="1180" fill="#123456"/>', bbox: { x: 0, y: 0, width: 790, height: 1180 } }),
    shape('overlay', { locked: true, markup: '<rect width="790" height="1180" fill="#abcdef"/>', bbox: { x: 0, y: 0, width: 790, height: 1180 } }),
  ] },
]);

test('Growing a middle section moves only subsequent offsets and total height', () => {
  const p = project(), after = resizeSection(p, 'b', 1400);
  assert.deepEqual(pageOffsets(after).map(x => x.top), [0, 1000, 2400]);
  assert.equal(flattenProject(after).height, 3400);
  assert.equal(after.pages[0], p.pages[0]); assert.equal(after.pages[2], p.pages[2]);
});
test('Shrinking a middle section closes the space below it', () => {
  const after = resizeSection(project(), 'b', 600);
  assert.deepEqual(pageOffsets(after).map(x => x.top), [0, 1000, 1600]);
  assert.equal(flattenProject(after).height, 2600);
});
test('Foreground text and product geometry/markup preserve identity', () => {
  const p = project(), after = resizeSection(p, 'b', 1800);
  assert.equal(after.pages[1].elements[1], p.pages[1].elements[1]);
  assert.equal(after.pages[1].elements[2], p.pages[1].elements[2]);
});
test('Background rect covers added area in actual markup and bbox', () => {
  const after = resizeSection(project(), 'b', 1800), bg = after.pages[1].elements[0];
  near(Number(attr(bg.markup, 'height')), 1800); near(bg.bbox.height, 1800);
  assert.equal(isPageBackground(bg, after.pages[1]), true);
});
test('Source-width 750 backgrounds update source units, not output pixels', () => {
  const after = resizeSection(seed, 'page-02', 1706), bg = after.pages[1].elements[0];
  near(Number(attr(bg.markup, 'height')) * 790 / 750, bg.bbox.height);
  assert.ok(bg.bbox.height >= 1706); assert.equal(bg.sy, 1);
});
test('Overscanned hero image keeps overscan ratio and cover viewport, without stretching', () => {
  const original = seed.pages[0].elements[0], after = resizeSection(seed, 'page-01', 2000), bg = after.pages[0].elements[0];
  near(bg.bbox.height / 2000, original.bbox.height / seed.pages[0].height);
  near(Number(attr(bg.markup, 'height')) * 790 / 750, bg.bbox.height);
  assert.equal(bg.bbox.x, -79); assert.equal(bg.bbox.width, 948);
  assert.equal(attr(bg.markup, 'preserveAspectRatio'), 'xMidYMid slice');
  assert.equal(bg.sy, 1); assert.equal(bg.sx, 1);
});
test('Repeated overscanned grow/shrink returns to original geometry', () => {
  let p = seed;
  for (const height of [1600, 700, 6000, 1306]) p = resizeSection(p, 'page-01', height);
  const bg = p.pages[0].elements[0], initial = seed.pages[0].elements[0];
  near(bg.bbox.height, initial.bbox.height); near(Number(attr(bg.markup, 'height')), 1488);
  assert.equal(isPageBackground(bg, p.pages[0]), true);
});
test('Full page backgrounds keep classification throughout extreme resize cycles', () => {
  let p = seed;
  for (const height of [6000, 400, 6000, 1180]) {
    p = resizeSection(p, 'page-03', height);
    for (const bg of p.pages[2].elements.slice(0, 2)) {
      assert.equal(isPageBackground(bg, p.pages[2]), true); assert.ok(visualBox(bg).height >= height - 1e-6);
    }
  }
});
test('Bounds and pixel rounding are explicit', () => {
  assert.equal(normalizeSectionHeight(399), MIN_SECTION_HEIGHT);
  assert.equal(normalizeSectionHeight(7000), MAX_SECTION_HEIGHT);
  assert.equal(normalizeSectionHeight(1234.7), 1235);
  assert.equal(resizeSection(project(), 'b', 10).pages[1].height, 400);
  assert.equal(resizeSection(project(), 'b', 1e9).pages[1].height, 6000);
});
test('Invalid height, unknown section, and unchanged height are reference no-ops', () => {
  const p = project();
  for (const height of [NaN, Infinity, -Infinity, 1000, 1000.1]) assert.equal(resizeSection(p, 'b', height), p);
  assert.equal(resizeSection(p, 'unknown', 1500), p);
});
test('No inputs are mutated and assets retain identity', () => {
  const p = project(), before = JSON.stringify(p); const after = resizeSection(p, 'b', 1400);
  assert.equal(JSON.stringify(p), before); assert.equal(after.assets, p.assets);
  assert.equal(after.pages[1].guides, p.pages[1].guides);
});
test('Last section resize changes total height without shifting prior sections', () => {
  const after = resizeSection(project(), 'c', 1800);
  assert.deepEqual(pageOffsets(after).map(x => x.top), [0, 1000, 2000]);
  assert.equal(flattenProject(after).height, 3800);
});
test('Section guides keep local coordinates; downstream horizontal guides move globally', () => {
  const p = project(), after = resizeSection(p, 'b', 1600), flat = flattenProject(after);
  assert.equal(flat.guides.find(g => g.id === elementKey('b', 'horizontal'))?.value, 1123);
  assert.equal(flat.guides.find(g => g.id === elementKey('c', 'horizontal'))?.value, 2723);
  assert.equal(flat.guides.find(g => g.id === elementKey('c', 'vertical'))?.value, 45);
});
test('An unlocked full-page image is not automatically resized', () => {
  const p = project(); p.pages[1].elements[0].locked = false;
  assert.equal(resizeSection(p, 'b', 1600).pages[1].elements[0], p.pages[1].elements[0]);
});
test('Background position and user scales survive proportional resize', () => {
  const p = project(); p.pages[1].elements[0] = shape('bg', { locked: true,
    markup: '<image x="-25" y="-30" width="850" height="1200" href="asset:photo" preserveAspectRatio="xMaxYMin meet"/>',
    bbox: { x: -25, y: -30, width: 850, height: 1200 }, tx: 5, ty: -10, sx: 1.1, sy: 1.2 });
  const after = resizeSection(p, 'b', 2000), bg = after.pages[1].elements[0];
  assert.equal(bg.tx, 5); assert.equal(bg.sx, 1.1); assert.equal(bg.sy, 1.2); assert.equal(bg.ty, -20);
  near(bg.bbox.y, -60); near(bg.bbox.height, 2400);
  assert.equal(attr(bg.markup, 'preserveAspectRatio'), 'xMaxYMin slice');
});
test('Generic transformed artwork uses one cover viewport across repeated resizes', () => {
  const p = project(); p.pages[1].elements[0].markup = '<g transform="translate(0 10)"><image width="790" height="1000" href="asset:photo"/></g>';
  let after = resizeSection(p, 'b', 1600);
  assert.match(after.pages[1].elements[0].markup, /^<svg/);
  const viewBox = attr(after.pages[1].elements[0].markup, 'viewBox');
  after = resizeSection(after, 'b', 600);
  after = resizeSection(after, 'b', 1500);
  const bg = after.pages[1].elements[0];
  assert.equal((bg.markup.match(/<svg/g) ?? []).length, 1);
  assert.equal(attr(bg.markup, 'viewBox'), viewBox);
  assert.equal(attr(bg.markup, 'height'), '1500');
  assert.match(bg.markup, /transform="translate\(0 10\)"/);
  assert.equal(attr(bg.markup, 'preserveAspectRatio'), 'xMidYMid slice');
});
test('Multiple background root nodes are wrapped, not partially resized', () => {
  const p = project(); p.pages[1].elements[0].markup = '<rect width="790" height="1000"/><image width="790" height="1000" href="asset:photo"/>';
  const bg = resizeSection(p, 'b', 1600).pages[1].elements[0];
  assert.match(bg.markup, /^<svg/); assert.equal(attr(bg.markup, 'height'), '1600');
});
test('Export slices adopt the resized height and downstream global Y', () => {
  const p = project(); p.pages.forEach(page => { page.elements = page.elements.slice(0, 1); });
  const after = resizeSection(p, 'b', 1600);
  assert.match(renderPageSvg(after, after.pages[1]), /width="790" height="1600" viewBox="0 1000 790 1600"/);
  assert.match(renderPageSvg(after, after.pages[2]), /width="790" height="1000" viewBox="0 2600 790 1000"/);
});
const require = createRequire(import.meta.url);
const sharp = require('sharp');
async function pixelChecks() {
const pixelProject = project();
pixelProject.pages.forEach(page => { page.elements = page.elements.slice(0, 1); });
for (const height of [1800, 400]) {
  const after = resizeSection(pixelProject, 'b', height);
  const image = await sharp(Buffer.from(renderPageSvg(after, after.pages[1]))).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  for (const [x, y] of [[0, 0], [789, height - 1], [395, height - 1], [395, Math.floor(height / 2)]]) {
    const offset = (y * image.info.width + x) * 4;
    assert.deepEqual([...image.data.subarray(offset, offset + 4)], [18, 52, 86, 255]);
  }
  passed++; console.log(`PASS Rendered ${height}px section background fills every sampled corner and added area`);
}
console.log(`${passed} section resize checks passed.`);
}
pixelChecks().catch(error => { console.error(error); process.exitCode = 1; });
