// Hub + P2P test: two isolated browser contexts (no shared tab bus).
// Run: npm run build && PORT=8787 npm run hub & node test/e2e/hub-p2p.mjs
import { chromium } from 'playwright';

const BASE = process.env.HUB || 'http://localhost:8787';
const browser = await chromium.launch({ args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream'] });
const errors = [];
const log = (...a) => console.log('•', ...a);
const RUN = Date.now().toString(36).slice(-4); // unique names: the hub directory persists between runs
process.on('uncaughtException', async (e) => {
  console.error('FAILED:', e.message.split('\n')[0], '\n' + errors.join('\n'));
  await browser.close();
  process.exit(1);
});

async function user(name, postcode) {
  const ctx = await browser.newContext({ viewport: { width: 400, height: 820 }, permissions: ['clipboard-read', 'clipboard-write'] });
  const p = await ctx.newPage();
  p.on('pageerror', (e) => errors.push(`[${name}] ${e.message}`));
  await p.goto(BASE + '/');
  await p.getByText('Get started').click();
  await p.getByPlaceholder('e.g. Amaka Obi').fill(name);
  await p.getByPlaceholder('LA 11 W06 TC 10').fill(postcode);
  await p.getByText('Create my 2qo').click();
  await p.waitForSelector('.dock');
  await p.locator('.netpill.ok').waitFor({ timeout: 8000 });
  return { ctx, p };
}

// ---- hub directory + chat
const ada = await user(`Ada ${RUN}`, 'KN 31 F82 WJ 80');
const bayo = await user(`Bayo ${RUN}`, 'KN 31 F82 WJ 12');
log('both connected to hub');
await ada.p.locator('.dock button', { hasText: 'Nearby' }).click();
await ada.p.getByText(`Bayo ${RUN}`).click();
await ada.p.fill('.composer textarea', 'via hub');
await ada.p.keyboard.press('Enter');
await bayo.p.getByText('via hub').first().waitFor({ timeout: 6000 });
log('directory search by postcode + relayed message');

// ---- store and forward: Bayo goes away, Ada sends, Bayo returns
await bayo.p.goto('about:blank');
await ada.p.waitForTimeout(500);
await ada.p.fill('.composer textarea', 'sent while you were offline');
await ada.p.keyboard.press('Enter');
await ada.p.waitForTimeout(800);
await bayo.p.goto(BASE + '/');
await bayo.p.getByText('sent while you were offline').first().waitFor({ timeout: 10000 });
log('store-and-forward delivered after reconnect');

// ---- P2P link via invite codes (no hub involvement in the data path)
const chi = await (async () => {
  const ctx = await browser.newContext({ viewport: { width: 400, height: 820 } });
  const p = await ctx.newPage();
  p.on('pageerror', (e) => errors.push(`[chi] ${e.message}`));
  await p.goto(BASE + '/');
  await p.evaluate(() => {}); // settle
  await p.getByText('Get started').click();
  await p.getByPlaceholder('e.g. Amaka Obi').fill(`Chi ${RUN}`);
  await p.getByText('Create my 2qo').click();
  await p.waitForSelector('.dock');
  return { ctx, p };
})();
await ada.p.goto(BASE + '/?go=connect');
await ada.p.locator('.chip', { hasText: 'Link phones' }).click();
await ada.p.getByText('Create link invite').click();
await ada.p.getByText('Copy invite code').waitFor();
// read the code from the clipboard via the Copy button
await ada.p.getByText('Copy invite code').click();
const code = await ada.p.evaluate(() => navigator.clipboard.readText());
if (!code || !/^[ZJ]/.test(code)) throw new Error('no invite code');
await chi.p.goto(BASE + '/?go=connect');
await chi.p.locator('.chip', { hasText: 'Scan / paste' }).click();
await chi.p.fill('textarea.inp', code);
await chi.p.getByText('Use code').click();
await chi.p.getByText('Copy reply code').waitFor({ timeout: 10000 });
await chi.ctx.grantPermissions(['clipboard-read', 'clipboard-write']);
await chi.p.getByText('Copy reply code').click();
const reply = await chi.p.evaluate(() => navigator.clipboard.readText());
await ada.p.fill('textarea.inp', reply);
await ada.p.locator('button.btn', { hasText: /^Connect$/ }).click();
await ada.p.getByText(`Chi ${RUN}`).first().waitFor({ timeout: 15000 });
log('P2P link established via invite/reply codes');
// switch the hub OFF on both phones so only the direct link can carry the message
for (const u of [ada, chi]) {
  await u.p.locator('.chip', { hasText: /^Hub$/ }).click();
  await u.p.locator('.row', { hasText: 'Auto-connect' }).locator('.toggle span').click();
  await u.p.getByText('Status: off').waitFor({ timeout: 5000 });
}
log('hub disabled on both phones');
await ada.p.locator('.hdr .ibtn[aria-label="Back"]').click();
await ada.p.locator('.dock button', { hasText: 'Nearby' }).click();
await ada.p.locator('.chip', { hasText: 'Everyone' }).click();
await ada.p.getByText(`Chi ${RUN}`).click();
await ada.p.fill('.composer textarea', 'hello over p2p');
await ada.p.keyboard.press('Enter');
await chi.p.locator('.hdr .ibtn[aria-label="Back"]').click(); // leave Connect without reloading (keeps the link)
await chi.p.getByText('hello over p2p').first().waitFor({ timeout: 8000 });
log('message delivered to P2P peer');

console.log(errors.length ? '\nERRORS:\n' + errors.join('\n') : '\nNo page errors');
await browser.close();
process.exit(errors.length ? 1 : 0);
