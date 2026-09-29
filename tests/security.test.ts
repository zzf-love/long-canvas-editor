import assert from 'node:assert/strict';
import { after, test } from 'node:test';
import { readFileSync } from 'node:fs';
import { JSDOM } from 'jsdom';
import { sanitizeSvgMarkup, validateProject } from '../src/projectIO';

const dom = new JSDOM('');
Object.assign(globalThis, { DOMParser: dom.window.DOMParser, XMLSerializer: dom.window.XMLSerializer });
after(() => dom.window.close());
const example = () => JSON.parse(readFileSync(new URL('../public/seed-project.json', import.meta.url), 'utf8'));

test('the public example validates and round-trips without customer assets or network references', () => {
  const input = example();
  const original = JSON.stringify(input);
  const checked = validateProject(input);
  assert.equal(checked.pages.length, 3);
  assert.equal(checked.width, 790);
  assert.deepEqual(Object.keys(checked.assets), []);
  assert.ok(checked.pages.every(page => page.elements.some(element => element.type === 'text')));
  assert.deepEqual(validateProject(JSON.parse(JSON.stringify(checked))), checked);
  assert.equal(JSON.stringify(input), original);
  assert.doesNotMatch(original, /\/Users\/|\/Volumes\/|https?:|file:/i);
});

test('SVG import removes active content, event handlers and remote resources', () => {
  const result = sanitizeSvgMarkup(`<script>alert(1)</script><foreignObject><div>active</div></foreignObject>
    <rect width="20" height="20" onload="alert(2)" fill="#fff"/>
    <image href="https://example.invalid/private.png"/>
    <use href="javascript:alert(3)"/><style>@import url(https://example.invalid/font.css)</style>
    <text style="font-size:12px;fill:url(https://example.invalid/x);color:#000">Safe label</text>`, {});
  assert.doesNotMatch(result, /script|foreignObject|onload|https:|javascript:|@import|<style/);
  assert.match(result, /Safe label/);
  assert.match(result, /fill="#fff"/);
});

test('SVG import retains local gradients and rejects unknown asset references', () => {
  const result = sanitizeSvgMarkup('<defs><linearGradient id="sky"><stop offset="0" stop-color="#fff"/></linearGradient></defs><rect width="20" height="20" fill="url(#sky)"/>', {});
  assert.match(result, /linearGradient/);
  assert.match(result, /url\(#sky\)/);
  assert.throws(() => sanitizeSvgMarkup('<image href="asset:missing"/>', {}), /找不到图片素材/);
  assert.throws(() => sanitizeSvgMarkup('<!DOCTYPE svg><rect/>', {}), /文档类型/);
  assert.throws(() => sanitizeSvgMarkup('<text>broken', {}), /无法读取/);
});

test('project import rejects ambiguous pages, invalid numbers and incompatible versions', () => {
  const input = example();
  assert.throws(() => validateProject({ ...input, pages: [input.pages[0], input.pages[0]] }), /页面标识重复/);
  assert.throws(() => validateProject({ ...input, schemaVersion: 2 }), /版本/);
  const bad = example();
  bad.pages[0].elements[0].tx = Infinity;
  assert.throws(() => validateProject(bad), /超出可用范围/);
});
