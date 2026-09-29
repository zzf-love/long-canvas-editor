import assert from 'node:assert/strict';
import { prefixSvgIds, renderPageSvg, resolveMarkup } from '../src/svg';
import { loadProjectFile, validateProject } from '../src/projectIO';
import type { Project } from '../src/types';

const png = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aD1sAAAAASUVORK5CYII=';
const assets = { bottle: { mime: 'image/png', data: png } };
assert.equal(resolveMarkup('<image href="asset:bottle"/>', assets), `<image href="data:image/png;base64,${png}"/>`);
assert.match(resolveMarkup("<image xlink:href='asset:bottle'/>", assets), /xlink:href="data:image\/png/);
assert.throws(() => resolveMarkup('<image href="asset:missing"/>', assets), /找不到图片/);
assert.equal(resolveMarkup('<text>href="asset:bottle"</text>', assets), '<text>href="asset:bottle"</text>');

const scoped = prefixSvgIds('<linearGradient id="gold"/><rect fill="url(#gold)"/><use href="#gold"/><path style="clip-path:url(\'#cut\')"/><text>id="gold"</text>', 'page-1');
assert.match(scoped, /id="p-page-1-gold"/);
assert.match(scoped, /fill="url\(#p-page-1-gold\)"/);
assert.match(scoped, /href="#p-page-1-gold"/);
assert.match(scoped, /url\(#p-page-1-cut\)/);
assert.match(scoped, /<text>id="gold"<\/text>/);
assert.notEqual(prefixSvgIds('<g id="x"/>', 'page 1'), prefixSvgIds('<g id="x"/>', 'page_20_1'));

const project: Project = {
  schemaVersion: 1, id: 'test', title: '测试', width: 790, updatedAt: new Date().toISOString(), assets,
  pages: [{ id: 'page-1', title: '页面', width: 790, sourceWidth: 750, height: 1200,
    defs: '<linearGradient id="gold"><stop offset="0" stop-color="#ffd"/></linearGradient>',
    guides: [{ id: 'guide-1', axis: 'x', value: 80 }],
    elements: [{ id: 'text', name: '标题', type: 'text', markup: '<text fill="url(#gold)" font-family="Arial">测试</text>', bbox: { x: 42, y: 50, width: 100, height: 40 }, tx: 10, ty: -5, sx: 1.2, sy: 0.8, hidden: false, locked: true },
      { id: 'image', name: '图片', type: 'image', markup: '<image href="asset:bottle"/>', bbox: { x: 0, y: 0, width: 100, height: 100 }, tx: 0, ty: 0, sx: 1, sy: 1, hidden: false, locked: false },
      { id: 'hidden', name: '隐藏', type: 'shape', markup: '<rect id="must-not-export"/>', bbox: { x: 0, y: 0, width: 1, height: 1 }, tx: 0, ty: 0, sx: 1, sy: 1, hidden: true, locked: false }],
  }],
};
const before = JSON.stringify(project);
const rendered = renderPageSvg(project, project.pages[0]);
assert.match(rendered, /width="790" height="1200"/);
assert.match(rendered, /translate\(10 -5\) translate\(42 50\) scale\(1.2 0.8\) translate\(-42 -50\)/);
const sourceScale = Number(rendered.match(/scale\((1\.053333[0-9]*)\)/)?.[1]);
assert.ok(Math.abs(sourceScale - 790 / 750) < 1e-9, 'source width is converted to physical canvas pixels');
assert.match(rendered, /font-family="PingFang SC/);
const gradientId = rendered.match(/<linearGradient id="([^"]+)"/)?.[1];
assert.ok(gradientId?.startsWith('p-test-page-1-'));
assert.ok(rendered.includes(`fill="url(#${gradientId})"`), 'rendered paint reference resolves to its scoped definition');
assert.match(rendered, /data:image\/png;base64,/);
assert.doesNotMatch(rendered, /must-not-export|guide-1|selection|handle|asset:bottle/);
assert.equal(JSON.stringify(project), before);
assert.throws(() => renderPageSvg({ ...project, width: 750 } as unknown as Project, project.pages[0]), /790/);
assert.throws(() => validateProject({ ...project, schemaVersion: 2 }), /版本/);
assert.throws(() => validateProject({ ...project, width: 750 }), /790/);
assert.throws(() => validateProject({ ...project, pages: [] }), /至少/);
assert.throws(() => validateProject({ ...project, assets: { bad: { mime: 'image/svg+xml', data: btoa('<svg/>') } } }), /PNG/);
assert.throws(() => validateProject({ ...project, assets: { bad: { mime: 'image/png', data: btoa('<svg/>') } } }), /类型与内容/);
async function verifyFileError() {
  await assert.rejects(loadProjectFile(new File(['{bad'], 'invalid.json')), /有效的JSON/);
  console.log('PASS: SVG embedding/scoping, source-scale transforms, hidden elements, font override, immutable rendering, project schema and image-type guards.');
  console.log('DOM SVG sanitizer, IndexedDB and canvas exports require integration checks in the editor browser.');
}
void verifyFileError().catch(error => { console.error(error); process.exitCode = 1; });
