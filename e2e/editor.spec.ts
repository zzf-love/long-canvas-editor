import { expect, test, type Download } from '@playwright/test';
import { readFile, mkdir } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import sharp from 'sharp';
import { hashPage } from '../scripts/background-server.mjs';

async function bytes(download: Download) {
  const file = await download.path();
  if (!file) throw new Error('Download did not produce a local file');
  return readFile(file);
}

test('edit, save, reimport, export and explicitly apply one queued revision', async ({ page, request }) => {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
  await page.goto('/');
  await expect(page).toHaveTitle(/Long Canvas/);
  await expect(page.getByRole('heading', { level: 1 })).toContainText('Long Canvas');
  await expect(page.locator('.page-item')).toHaveCount(3);
  await expect(page.locator('vite-error-overlay')).toHaveCount(0);
  await expect(page.locator('.background-sync-state')).toContainText('文件已同步', { timeout: 15_000 });

  if (process.env.LONG_CANVAS_QA_DIR) {
    await mkdir(process.env.LONG_CANVAS_QA_DIR, { recursive: true });
    await page.screenshot({ path: join(process.env.LONG_CANVAS_QA_DIR, 'editor-desktop.png') });
  }

  await page.getByRole('button', { name: '文字', exact: true }).click();
  await page.getByLabel('文本内容', { exact: true }).fill('Open source editing works');
  await page.getByRole('heading', { level: 1 }).click();
  const saved = page.waitForEvent('download');
  await page.getByRole('button', { name: '保存工程', exact: true }).click();
  const savedBytes = await bytes(await saved);
  const project = JSON.parse(savedBytes.toString());
  expect(project.pages).toHaveLength(3);
  expect(JSON.stringify(project)).toContain('Open source editing works');

  await page.getByRole('button', { name: '撤销', exact: true }).click();
  await page.locator('input[type="file"]').first().setInputFiles({ name: 'saved-project.json', mimeType: 'application/json', buffer: savedBytes });
  await expect(page.getByRole('status')).toContainText('工程已打开');
  await page.getByRole('button', { name: '整页预览', exact: true }).click();
  await expect(page.locator('.preview-pages')).toContainText('Open source editing works');
  await page.getByRole('button', { name: '关闭整页预览' }).click();

  for (const [label, expectedHeight] of [['当前屏 PNG', project.pages[0].height], ['完整长图 PNG', project.pages.reduce((sum: number, item: any) => sum + item.height, 0)]] as const) {
    await page.getByRole('button', { name: '导出图片', exact: true }).click();
    const downloading = page.waitForEvent('download');
    await page.getByRole('button', { name: new RegExp(label) }).click();
    const png = await bytes(await downloading);
    const metadata = await sharp(png).metadata();
    expect(metadata.width).toBe(790);
    expect(metadata.height).toBe(expectedHeight);
    expect((await sharp(png).stats()).channels.some(channel => channel.stdev > 20)).toBe(true);
  }

  const headers = { 'X-Long-Canvas-Bridge': '1' };
  await expect.poll(async () => {
    const response = await request.get('/api/snapshot', { headers });
    return response.ok() ? JSON.stringify(await response.json()).includes('Open source editing works') : false;
  }).toBe(true);
  const snapshotResponse = await request.get('/api/snapshot', { headers });
  const snapshot = await snapshotResponse.json();
  const sourcePage = snapshot.pages[0];
  const sourceLayer = sourcePage.elements.find((element: any) => element.markup.includes('Open source editing works'));
  const update = {
    id: 'e2e-explicit-revision', expectedPageHash: hashPage(sourcePage),
    patch: { kind: 'long-canvas-page-update', schemaVersion: 1, targetProjectId: snapshot.id, pageId: sourcePage.id,
      sourceWidth: sourcePage.sourceWidth, title: 'Example queued revision', preserveLayerOrder: true,
      elements: [{ ...sourceLayer, markup: sourceLayer.markup.replace('Open source editing works', 'Revision applied explicitly') }],
      removeElementIds: [], assets: {} },
  };
  const queued = await request.post('/api/updates', { headers, data: update });
  expect(queued.status()).toBe(201);
  await expect(page.getByRole('button', { name: '应用最新改稿', exact: true })).toBeEnabled({ timeout: 10_000 });
  const beforeClick = await request.get('/api/snapshot', { headers });
  expect(JSON.stringify(await beforeClick.json())).not.toContain('Revision applied explicitly');
  await page.getByRole('button', { name: '应用最新改稿', exact: true }).click();
  await expect(page.getByRole('status')).toContainText('已应用', { timeout: 10_000 });
  await page.getByRole('button', { name: '整页预览', exact: true }).click();
  await expect(page.locator('.preview-pages')).toContainText('Revision applied explicitly');
  expect(errors).toEqual([]);
});

test('single-file editor opens offline and restores a local edit after reload', async ({ page, context }) => {
  await context.setOffline(true);
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto(pathToFileURL(resolve('release/long-canvas-editor.html')).href);
  await expect(page.getByRole('heading', { level: 1 })).toContainText('Long Canvas');
  await page.getByRole('button', { name: '文字', exact: true }).click();
  await page.getByLabel('文本内容', { exact: true }).fill('Offline draft survives reload');
  await page.getByRole('heading', { level: 1 }).click();
  await expect(page.locator('.save-state')).toContainText('本机已保存', { timeout: 10_000 });
  await page.reload();
  await page.getByRole('button', { name: '整页预览', exact: true }).click();
  await expect(page.locator('.preview-pages')).toContainText('Offline draft survives reload');
  expect(errors).toEqual([]);
});
