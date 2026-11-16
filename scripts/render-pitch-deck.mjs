import { chromium } from '@playwright/test';
import { resolve } from 'node:path';

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({
  viewport: { width: 1280, height: 720 },
  deviceScaleFactor: 1,
});
const input = resolve('docs/gitshaman-pitch-deck.html');
await page.goto(`file://${input}`, { waitUntil: 'load' });
await page.pdf({
  path: resolve('docs/gitshaman-pitch-deck.pdf'),
  printBackground: true,
  preferCSSPageSize: true,
  margin: { top: '0', right: '0', bottom: '0', left: '0' },
});
await browser.close();
console.log('Wrote docs/gitshaman-pitch-deck.pdf');
