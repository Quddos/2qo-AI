// Renders the SVG app icons to PNG (run once: node scripts/icons.mjs). Requires Playwright.
import { chromium } from 'playwright';
import { readFileSync } from 'node:fs';

const jobs = [
  ['public/icons/icon.svg', 'public/icons/icon-192.png', 192],
  ['public/icons/icon.svg', 'public/icons/icon-512.png', 512],
  ['public/icons/maskable.svg', 'public/icons/maskable-512.png', 512],
  ['public/icons/icon.svg', 'public/icons/badge.png', 96],
];
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM || undefined });
const page = await browser.newPage();
for (const [src, out, size] of jobs) {
  await page.setViewportSize({ width: size, height: size });
  await page.setContent(`<style>html,body{margin:0;background:transparent}</style><img src="data:image/svg+xml;base64,${readFileSync(src).toString('base64')}" width="${size}" height="${size}">`);
  await page.screenshot({ path: out, omitBackground: true });
  console.log('wrote', out);
}
await browser.close();
