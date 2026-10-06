import { existsSync, readdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { chromium } from 'playwright-core';

const BASE = (process.env.BASE_URL ?? 'http://127.0.0.1:3000').replace(/\/$/, '');
const WIDTHS = [390, 768, 1280];

function findChromium() {
  if (process.env.CHROMIUM_PATH) return process.env.CHROMIUM_PATH;
  const root = join(homedir(), '.cache', 'ms-playwright');
  if (!existsSync(root)) return undefined;
  for (const dir of readdirSync(root).filter(d => d.startsWith('chromium')).sort().reverse()) {
    for (const sub of readdirSync(join(root, dir))) {
      for (const bin of ['chrome-headless-shell', 'chrome']) {
        const p = join(root, dir, sub, bin);
        if (existsSync(p)) return p;
      }
    }
  }
  return undefined;
}

const failures = [];
const check = (ok, name, detail = '') => {
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${detail ? ` (${detail})` : ''}`);
  if (!ok) failures.push(name);
};

const api = await fetch(`${BASE}/api/v1/mints`).then(r => (r.ok ? r.json() : null)).catch(() => null);
check(!!api && Array.isArray(api.mints) && api.mints.length > 0, 'GET /api/v1/mints');
const mintId = api?.mints?.find(m => m.state === 'ok')?.id ?? api?.mints?.[0]?.id;
const compareIds = (api?.mints ?? []).slice(0, 3).map(m => `m=${m.id}`).join('&');

for (const [path, status] of [['/api/run-swap', 401], ['/api/status', 401], ['/api/v1/network?range=7d', 200], ['/nope', 404]]) {
  const r = await fetch(`${BASE}${path}`).catch(() => null);
  check(r?.status === status, `GET ${path} -> ${status}`, r ? String(r.status) : 'no response');
}

const browser = await chromium.launch({ executablePath: findChromium(), args: ['--no-sandbox'] });
const pages = ['/', '/?q=cashu', '/methodology', '/infrastructure', `/compare?${compareIds}`, ...(mintId ? [`/mint/${mintId}`] : [])];

for (const path of pages) {
  for (const width of WIDTHS) {
    const ctx = await browser.newContext({ viewport: { width, height: 900 } });
    const page = await ctx.newPage();
    const errors = [];
    page.on('pageerror', e => errors.push(e.message));
    page.on('console', m => m.type() === 'error' && errors.push(m.text()));
    await page.addInitScript(() => document.addEventListener('securitypolicyviolation', e => console.error(`CSP ${e.violatedDirective} ${e.blockedURI}`)));
    const res = await page.goto(`${BASE}${path}`, { waitUntil: 'load' });
    await page.waitForTimeout(400);
    const over = await page.evaluate(() => ({
      page: document.documentElement.scrollWidth - document.documentElement.clientWidth,
      tables: [...document.querySelectorAll('.table-wrap')].filter(t => t.scrollWidth - t.clientWidth > 0).length,
    }));
    check(res?.status() === 200 && errors.length === 0 && over.page <= 0 && over.tables === 0, `${path} @${width}`,
      [res?.status() !== 200 ? `status ${res?.status()}` : '', errors[0] ?? '', over.page > 0 ? `page +${over.page}px` : '', over.tables ? `${over.tables} tables overflow` : ''].filter(Boolean).join(', '));
    await ctx.close();
  }
}

{
  const page = await browser.newPage({ viewport: { width: 1280, height: 1000 } });
  await page.goto(`${BASE}/`, { waitUntil: 'load' });
  const live = await page.waitForSelector('.live-live', { timeout: 15000 }).then(() => true).catch(() => false);
  check(live, 'live updates connect');
  await page.waitForSelector('.network-stage');
  await page.evaluate(() => document.querySelector('.network-stage')?.scrollIntoView());
  const loaded = await page.waitForFunction(() => /^[1-9]/.test(document.querySelector('.network-bar .muted')?.textContent ?? ''), null, { timeout: 15000 }).then(() => true).catch(() => false);
  check(loaded, 'network loads');
  const before = await page.getAttribute('.network-graph > g', 'transform');
  await page.click('button[aria-label="Zoom in"]');
  check((await page.getAttribute('.network-graph > g', 'transform')) !== before, 'network zoom');
  const label = await page.evaluate(() => document.querySelector('.network-graph .node')?.getAttribute('aria-label')?.split(',')[0] ?? '');
  if (label) {
    await page.fill('.network-search', label);
    const panel = await page.waitForSelector('.network-panel', { timeout: 5000 }).then(() => true).catch(() => false);
    check(panel, 'network search focuses a mint');
  }
  await page.click('.nav-donate');
  const dialog = await page.waitForSelector('dialog.sheet[open]', { timeout: 5000 }).then(() => true).catch(() => false);
  check(dialog, 'donate dialog opens');
  if (dialog) {
    await page.click('dialog.sheet [role="tab"]:nth-child(2)');
    check(await page.isVisible('dialog.sheet .qr svg'), 'donate dialog shows the ecash QR');
  }
  await page.close();
}

await browser.close();
console.log(failures.length ? `\n${failures.length} smoke check(s) failed` : '\nall smoke checks passed');
process.exit(failures.length ? 1 : 0);
