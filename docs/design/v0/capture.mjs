import { chromium } from 'playwright-core';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const shots = [
  { file: 'widget-locked.html', w: 420, h: 320 },
  { file: 'widget-unlocking.html', w: 420, h: 340 },
  { file: 'settings.html', w: 480, h: 720 },
  { file: 'tray-menu.html', w: 520, h: 420 },
  { file: 'tip-wrong-key.html', w: 480, h: 400 },
];

const browser = await chromium.launch({
  executablePath: process.env.CHROME_PATH || '/usr/bin/google-chrome',
  args: ['--no-sandbox', '--disable-dev-shm-usage'],
});

for (const s of shots) {
  const page = await browser.newPage({
    viewport: { width: s.w, height: s.h },
    deviceScaleFactor: 2,
  });
  const url = 'file://' + path.join(__dirname, s.file);
  await page.goto(url, { waitUntil: 'networkidle' });
  await page.waitForTimeout(200);
  const out = path.join(__dirname, s.file.replace('.html', '.png'));
  await page.screenshot({ path: out, type: 'png' });
  console.log('ok', out);
  await page.close();
}

await browser.close();
