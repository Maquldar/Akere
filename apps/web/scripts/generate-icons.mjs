// Renders the SVG app icons to PNG with headless Chromium (run: node scripts/generate-icons.mjs).
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { chromium } from '@playwright/test';

const dir = fileURLToPath(new URL('../public/icons/', import.meta.url));
const targets = [
  { src: 'icon.svg', out: 'icon-192.png', size: 192, transparent: true },
  { src: 'icon.svg', out: 'icon-512.png', size: 512, transparent: true },
  { src: 'icon-maskable.svg', out: 'icon-maskable-512.png', size: 512 },
  { src: 'icon-maskable.svg', out: 'apple-touch-icon.png', size: 180 },
];

const browser = await chromium.launch();
const page = await browser.newPage();
for (const t of targets) {
  const svg = readFileSync(dir + t.src, 'utf8');
  await page.setViewportSize({ width: t.size, height: t.size });
  await page.setContent(
    `<html><body style="margin:0;background:transparent"><div style="width:${t.size}px;height:${t.size}px">${svg.replace('<svg ', `<svg width="${t.size}" height="${t.size}" `)}</div></body></html>`,
  );
  await page.screenshot({ path: dir + t.out, omitBackground: Boolean(t.transparent), clip: { x: 0, y: 0, width: t.size, height: t.size } });
  console.log('wrote', t.out);
}
await browser.close();
