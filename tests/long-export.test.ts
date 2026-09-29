import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createRequire } from 'node:module';
import { renderPageSvg } from '../src/svg';
import { elementKey, flattenProject, relocateElements } from '../src/longLayout';
import type { DesignElement, DesignPage, Project } from '../src/types';

const require = createRequire(import.meta.url);
const sharp = require('sharp');
const factor = 790 / 750;
function rect(id: string, x: number, y: number, w: number, h: number, fill: string,
  extra: Partial<DesignElement> = {}): DesignElement {
  return { id, name: id, type: 'shape', markup: `<rect x="${x}" y="${y}" width="${w}" height="${h}" fill="${fill}"/>`,
    bbox: { x: x * factor, y: y * factor, width: w * factor, height: h * factor },
    tx: 0, ty: 0, sx: 1, sy: 1, hidden: false, locked: false, ...extra };
}
function page(id: string, elements: DesignElement[], color: string): DesignPage {
  return { id, title: id, width: 790, height: 400, sourceWidth: 750,
    defs: `<linearGradient id="shared"><stop stop-color="${color}"/><stop offset="1" stop-color="${color}"/></linearGradient>`,
    elements, guides: [{ id: 'guide', axis: 'x', value: 50 }] };
}
function fixture(): Project {
  return { schemaVersion: 1, id: 'test', title: 'Cross sections', width: 790,
    updatedAt: '2026-09-18T00:00:00.000Z', assets: { distant: { mime: 'image/png', data: 'QUJDREVG' } },
    pages: [
      page('first', [
        rect('bg', 0, 0, 750, 400 / factor, '#ffffff', { locked: true }),
        rect('down', 75, 350, 75, 60, '#ff0000'),
        rect('gradient', 5, 5, 20, 20, 'url(#shared)'),
        rect('hidden', 500, 350, 20, 60, '#ff00ff', { hidden: true }),
      ], '#ff9900'),
      page('second', [
        rect('bg', 0, 0, 750, 400 / factor, '#eeeeee', { locked: true }),
        rect('up', 225, 10, 75, 80, '#00ff00', { ty: -60 }),
        rect('gradient', 5, 5, 20, 20, 'url(#shared)'),
        rect('scaled', 300, 120, 30, 20, '#0000ff', { tx: 12, ty: 25, sx: 1.5, sy: 2 }),
      ], '#0099ff'),
      page('third', [
        rect('bg', 0, 0, 750, 400 / factor, '#cccccc', { locked: true }),
        rect('far', 0, 200, 50, 50, 'none', { type: 'image', markup: '<image x="0" y="200" width="50" height="50" href="asset:distant"/>' }),
      ], '#aaaaaa'),
    ] };
}
async function pixels(svg: string) {
  return sharp(Buffer.from(svg)).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
}
function rgba(image: any, x: number, y: number): number[] {
  const offset = (y * image.info.width + x) * 4;
  return [...image.data.subarray(offset, offset + 4)];
}

test('slice retains the 790px width and exact section height while using global Y coordinates', () => {
  const project = fixture();
  const output = renderPageSvg(project, project.pages[1]);
  assert.match(output, /width="790" height="400" viewBox="0 400 790 400"/);
  assert.doesNotMatch(output, /asset:distant|QUJDREVG|#ff00ff|guide|selection|data-element-id/);
});

test('a foreground moved below a section remains visible above the next section background', async () => {
  const project = fixture();
  const first = await pixels(renderPageSvg(project, project.pages[0]));
  const second = await pixels(renderPageSvg(project, project.pages[1]));
  assert.deepEqual(rgba(first, 100, 390), [255, 0, 0, 255]);
  assert.deepEqual(rgba(second, 100, 10), [255, 0, 0, 255]);
  assert.deepEqual(rgba(second, 100, 50), [238, 238, 238, 255]);
});

test('a foreground moved upward is included in the preceding slice and continuous across the join', async () => {
  const project = fixture();
  const first = await pixels(renderPageSvg(project, project.pages[0]));
  const second = await pixels(renderPageSvg(project, project.pages[1]));
  assert.deepEqual(rgba(first, 250, 360), [0, 255, 0, 255]);
  assert.deepEqual(rgba(first, 250, 399), [0, 255, 0, 255]);
  assert.deepEqual(rgba(second, 250, 0), [0, 255, 0, 255]);
  assert.deepEqual(rgba(second, 250, 20), [0, 255, 0, 255]);
});

test('duplicate gradient IDs from separate source pages retain distinct paints', async () => {
  const project = fixture();
  const first = await pixels(renderPageSvg(project, project.pages[0]));
  const second = await pixels(renderPageSvg(project, project.pages[1]));
  assert.deepEqual(rgba(first, 10, 10), [255, 153, 0, 255]);
  assert.deepEqual(rgba(second, 10, 10), [0, 153, 255, 255]);
});

test('source 750px conversion and edited scale keep the expected visual position and size', async () => {
  const project = fixture();
  const second = await pixels(renderPageSvg(project, project.pages[1]));
  // x = 300*790/750+12 = 328; y = 120*790/750+25 = 151.4.
  // Width 31.6*1.5=47.4 and height 21.0667*2=42.1333.
  assert.deepEqual(rgba(second, 329, 153), [0, 0, 255, 255]);
  assert.deepEqual(rgba(second, 373, 190), [0, 0, 255, 255]);
  assert.deepEqual(rgba(second, 327, 170), [238, 238, 238, 255]);
  assert.deepEqual(rgba(second, 377, 170), [238, 238, 238, 255]);
});

test('all slices match the same pixels in the complete continuous composition', async () => {
  const project = fixture();
  // Do not need the deliberately invalid distant raster for this rendering comparison.
  project.pages[2].elements.pop();
  const full = renderPageSvg(project, flattenProject(project));
  for (let index = 0; index < project.pages.length; index++) {
    const slice = await pixels(renderPageSvg(project, project.pages[index]));
    const expected = await sharp(Buffer.from(full)).extract({ left: 0, top: index * 400, width: 790, height: 400 }).ensureAlpha().raw().toBuffer();
    assert.deepEqual(slice.data, expected, `slice ${index + 1} differs from continuous render`);
  }
});

test('moving ownership across differently scaled pages preserves pixels and gradient definitions', async () => {
  const project = fixture();
  project.pages[2].elements.pop();
  project.pages[1].sourceWidth = 790;
  project.pages[1].elements = project.pages[1].elements.map(element => ({
    ...element, markup: `<g transform="scale(${factor})">${element.markup}</g>`,
  }));
  const selected = [elementKey('first', 'gradient')];
  const preview = relocateElements(project, selected, 40, 600, false);
  const committed = relocateElements(project, selected, 40, 600, true);
  assert.ok(!committed.pages[0].elements.some(element => element.id === 'gradient'));
  const before = await pixels(renderPageSvg(preview, preview.pages[1]));
  const after = await pixels(renderPageSvg(committed, committed.pages[1]));
  assert.deepEqual(after.data, before.data);
  assert.deepEqual(rgba(after, 50, 210), [255, 153, 0, 255]);
});

test('a transformed locked background remains clipped to its section after height changes', async () => {
  const p = fixture();
  p.pages[0].height = 600;
  p.pages[0].elements = [rect('bg', 0, 0, 750, 600 / factor, '#ff0000', { locked: true, sx: 1.2, sy: 1.4, tx: -10, ty: -30 })];
  p.pages[1].elements = [];
  const second = await pixels(renderPageSvg(p, p.pages[1]));
  assert.deepEqual(rgba(second, 100, 5), [255, 255, 255, 255]);
  const first = await pixels(renderPageSvg(p, p.pages[0]));
  assert.deepEqual(rgba(first, 100, 595), [255, 0, 0, 255]);
});
