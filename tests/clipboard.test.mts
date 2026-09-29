import assert from 'node:assert/strict';
import {test} from 'node:test';
import {webcrypto} from 'node:crypto';
import {captureElements, pasteElements} from '../src/elementClipboard';
import {elementKey} from '../src/longLayout';
import {visualBox, unionBoxes} from '../src/geometry';
import type {DesignElement, DesignPage, Project} from '../src/types';

Object.defineProperty(globalThis, 'crypto', {value: webcrypto, configurable: true});
const layer = (id: string, x = 50, y = 100, width = 100, height = 40): DesignElement => ({
  id, name: id, type: 'shape', markup: `<rect x="${x}" y="${y}" width="${width}" height="${height}" fill="#123456"/>`,
  bbox: {x, y, width, height}, tx: 0, ty: 0, sx: 1, sy: 1, locked: false, hidden: false,
});
const page = (id: string, elements: DesignElement[] = [], sourceWidth = 790, height = 1000): DesignPage => ({
  id, title: id, width: 790, height, sourceWidth, defs: '', guides: [], elements,
});
const project = (pages: DesignPage[] = [page('a', [layer('one'), layer('two', 180, 100)]), page('b')]): Project => ({
  schemaVersion: 1, id: 'test-project', title: 'Test', width: 790, updatedAt: '2026-09-19T00:00:00.000Z', pages, assets: {},
});
const key = (id: string, pageId = 'a') => elementKey(pageId, id);
const approximate = (a: number, b: number) => assert.ok(Math.abs(a - b) < 1e-7, `${a} != ${b}`);

test('copies independent snapshots in stacking order and excludes locked/hidden layers', () => {
  const p = project();
  p.pages[0].elements.push({...layer('locked'), locked: true}, {...layer('hidden'), hidden: true});
  const c = captureElements(p, [key('two'), key('hidden'), key('one'), key('locked'), key('missing')])!;
  assert.equal(c.count, 2);
  assert.deepEqual(c.pages[0].elements.map(e => e.id), ['one', 'two']);
  p.pages[0].elements[0].bbox.x = 700;
  p.pages[0].elements[0].markup = '<circle r="10"/>';
  assert.equal(c.pages[0].elements[0].bbox.x, 50);
  assert.match(c.pages[0].elements[0].markup, /rect/);
  assert.equal(captureElements(p, [key('locked'), key('hidden')]), null);
});

test('same-page paste offsets 16px; repeated paste offsets32 and preserves original project', () => {
  const p = project();
  const before = JSON.stringify(p);
  const c = captureElements(p, [key('one'), key('two')])!;
  const first = pasteElements(p, c, 'a');
  const second = pasteElements(first.project, c, 'a', 1);
  assert.equal(JSON.stringify(p), before);
  assert.equal(first.project.pages[1], p.pages[1]);
  assert.equal(first.project.pages[0].elements[0], p.pages[0].elements[0]);
  assert.deepEqual(first.project.pages[0].elements.slice(2).map(visualBox), [
    {x: 66, y: 116, width: 100, height: 40}, {x: 196, y: 116, width: 100, height: 40},
  ]);
  assert.equal(visualBox(second.project.pages[0].elements[4]).x, 82);
  assert.equal(new Set(second.project.pages[0].elements.map(e => e.id)).size, 6);
  assert.equal(new Set([...first.selected, ...second.selected]).size, 4);
});

test('cross-page paste preserves local positions, styles, scaling, opacity and independent links', () => {
  const p = project();
  p.pages[0].elements = p.pages[0].elements.map(e => ({...e, linkId: 'pair', opacity: .37, tx: 11, ty: 9, sx: 1.5, sy: .8}));
  const c = captureElements(p, [key('one'), key('two')])!;
  const first = pasteElements(p, c, 'b');
  const second = pasteElements(first.project, c, 'b', 1);
  const a = first.project.pages[1].elements;
  assert.deepEqual(a.map(visualBox), p.pages[0].elements.map(visualBox));
  assert.equal(a[0].opacity, .37); assert.equal(a[0].sx, 1.5); assert.equal(a[0].sy, .8);
  assert.equal(a[0].markup, p.pages[0].elements[0].markup);
  assert.equal(a[0].linkId, a[1].linkId); assert.notEqual(a[0].linkId, 'pair');
  assert.notEqual(second.project.pages[1].elements[2].linkId, a[0].linkId);
  assert.equal(visualBox(second.project.pages[1].elements[2]).y, 125);
});

test('source-width conversion preserves actual rendered coordinates and final boxes in both directions', () => {
  for (const [sourceWidth, targetWidth] of [[750, 790], [790, 750]]) {
    const e = {...layer('one'), bbox: {x: 50 * 790 / sourceWidth, y: 100 * 790 / sourceWidth, width: 100 * 790 / sourceWidth, height: 40 * 790 / sourceWidth}, sx: 1.4, sy: .8, tx: 11, ty: 9};
    const p = project([page('a', [e], sourceWidth), page('b', [], targetWidth)]);
    const c = captureElements(p, [key('one')])!;
    const after = pasteElements(p, c, 'b').project.pages[1].elements[0];
    assert.deepEqual(visualBox(after), visualBox(e));
    const ratio = Number(after.markup.match(/scale\(([^)]+)\)/)?.[1]);
    for (const [x, y] of [[50, 100], [90, 120], [150, 140]]) {
      const oldX = (x * 790 / sourceWidth - e.bbox.x) * e.sx + e.bbox.x + e.tx;
      const oldY = (y * 790 / sourceWidth - e.bbox.y) * e.sy + e.bbox.y + e.ty;
      const newX = (x * ratio * 790 / targetWidth - after.bbox.x) * after.sx + after.bbox.x + after.tx;
      const newY = (y * ratio * 790 / targetWidth - after.bbox.y) * after.sy + after.bbox.y + after.ty;
      approximate(oldX, newX); approximate(oldY, newY);
    }
  }
});

test('cross-screen selections retain relative global arrangement and clamp together without resizing', () => {
  const p = project([page('a', [layer('one', 600, 900)]), page('b', [layer('two', 600, 60)]), page('c', [], 750, 450)]);
  const c = captureElements(p, [key('two', 'b'), key('one')])!;
  const copied = pasteElements(p, c, 'c').project.pages[2].elements;
  assert.equal(visualBox(copied[1]).y - visualBox(copied[0]).y, 160);
  assert.equal(visualBox(copied[0]).y, 250);
  assert.equal(visualBox(copied[1]).y, 410);
  assert.equal(copied[1].bbox.y, 1060);
  assert.match(copied[1].markup, /translate\(0 949\.3670886076\) scale\(0\.9493670886\)/);
  assert.deepEqual(unionBoxes(copied.map(visualBox)), {x: 600, y: 250, width: 100, height: 200});
  const smaller = {...p, pages: p.pages.map(page => page.id === 'c' ? {...page, height: 150} : page)};
  const large = pasteElements(smaller, c, 'c').project.pages[2].elements;
  assert.deepEqual(unionBoxes(large.map(visualBox)), {x: 600, y: 0, width: 100, height: 200});
});

test('crop and gradient dependencies transfer transitively and get unique IDs on every paste', () => {
  const p = project();
  p.pages[0].defs = '<linearGradient id="base"><stop offset="0" stop-color="#fff"/></linearGradient><linearGradient id="fade" href="#base"/><path id="outline" d="M0 0H50V50Z"/><clipPath id="crop"><use href="#outline"/></clipPath><linearGradient id="unused"/>';
  p.pages[0].elements[0].markup = '<g id="local" clip-path="url(#crop)"><rect fill="url(#fade)" width="50" height="50"/></g>';
  const c = captureElements(p, [key('one')])!;
  assert.doesNotMatch(c.pages[0].defs, /unused/);
  for (const id of ['base', 'fade', 'outline', 'crop']) assert.match(c.pages[0].defs, new RegExp(`id="${id}"`));
  const first = pasteElements(p, c, 'b');
  const second = pasteElements(first.project, c, 'b', 1).project.pages[1];
  const markup = second.defs + second.elements.map(e => e.markup).join('');
  const ids = [...markup.matchAll(/\sid="([^"]+)"/g)].map(match => match[1]);
  const references = [...markup.matchAll(/(?:url\(#|href="#)([^)"\s]+)/g)].map(match => match[1]);
  assert.equal(ids.length, 10); assert.equal(new Set(ids).size, ids.length);
  for (const reference of references) assert.ok(ids.includes(reference));
  assert.equal(first.project.pages[0], p.pages[0]);
});

test('only needed assets are captured, collision remaps markup and defs, repeats reuse assets', () => {
  const p = project();
  p.assets = {photo: {mime: 'image/png', data: 'AAAA'}, extra: {mime: 'image/png', data: 'BBBB'}};
  p.pages[0].defs = '<pattern id="texture"><image href="asset:photo" width="10" height="10"/></pattern>';
  p.pages[0].elements[0].markup = '<g><image href="asset:photo"/><rect fill="url(#texture)"/></g>';
  const c = captureElements(p, [key('one')])!;
  assert.deepEqual(Object.keys(c.assets), ['photo']);
  p.assets.photo.data = 'ZZZZ';
  assert.equal(c.assets.photo.data, 'AAAA');
  const target = project([page('target')]); target.id = 'different'; target.assets = {photo: {mime: 'image/png', data: 'CCCC'}};
  const first = pasteElements(target, c, 'target');
  const assetId = Object.keys(first.project.assets).find(id => id !== 'photo')!;
  assert.equal(first.project.assets.photo.data, 'CCCC'); assert.equal(first.project.assets[assetId].data, 'AAAA');
  assert.ok(first.project.pages[0].elements[0].markup.includes(`asset:${assetId}`));
  assert.ok(first.project.pages[0].defs.includes(`asset:${assetId}`));
  const second = pasteElements(first.project, c, 'target', 1);
  assert.equal(Object.keys(second.project.assets).length, 2);
});

test('copy survives deletion of source layers/pages and unchanged/noop/error cases are atomic', () => {
  const p = project();
  const c = captureElements(p, [key('one')])!;
  const cut = {...p, pages: [p.pages[1]]};
  const pasted = pasteElements(cut, c, 'b');
  assert.equal(pasted.project.pages[0].elements.length, 1);
  assert.equal(visualBox(pasted.project.pages[0].elements[0]).x, 50);
  assert.equal(pasteElements(p, c, 'missing').project, p);
  assert.equal(pasteElements(p, {...c, count: 0}, 'a').project, p);
  const full = {...p, pages: [page('b', Array.from({length: 3000}, (_, i) => layer(`full-${i}`)))]};
  const before = JSON.stringify(full);
  assert.throws(() => pasteElements(full, c, 'b'), /数量超出/);
  assert.equal(JSON.stringify(full), before);
});
