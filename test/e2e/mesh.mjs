// Mesh test: A↔B and B↔C are linked by invite codes; A and C never paired directly.
// A must discover C through B and message C (B relays the encrypted envelope; it cannot read it).
import { chromium } from 'playwright';

const BASE = process.env.BASE || 'http://localhost:4173';
const errors = [];
const log = (...a) => console.log('•', ...a);
const browser = await chromium.launch();
process.on('uncaughtException', async (e) => {
  console.error('FAILED:', e.message.split('\n')[0], '\n' + errors.join('\n'));
  await browser.close();
  process.exit(1);
});

async function phone(name) {
  const ctx = await browser.newContext({ viewport: { width: 400, height: 820 }, permissions: ['clipboard-read', 'clipboard-write'] });
  const p = await ctx.newPage();
  p.on('pageerror', (e) => errors.push(`[${name}] ${e.message}`));
  await p.goto(BASE + '/?go=connect');
  await p.getByText('Get started').click();
  await p.getByPlaceholder('e.g. Amaka Obi').fill(name);
  await p.getByText('Create my 2qo').click();
  await p.waitForSelector('.dock');
  await p.goto(BASE + '/?go=connect');
  return p;
}

async function link(a, b) {
  await a.locator('.chip', { hasText: 'Link phones' }).click();
  await a.getByText('Create link invite').click();
  await a.getByText('Copy invite code').click();
  const invite = await a.evaluate(() => navigator.clipboard.readText());
  await b.locator('.chip', { hasText: 'Scan / paste' }).click();
  await b.fill('textarea.inp', invite);
  await b.getByText('Use code').click();
  await b.getByText('Copy reply code').click();
  const reply = await b.evaluate(() => navigator.clipboard.readText());
  await a.fill('textarea.inp', reply);
  await a.locator('button.btn', { hasText: /^Connect$/ }).click();
  await b.getByText('Done', { exact: true }).click();
}

const A = await phone('Amaka Mesh');
const B = await phone('Bello Mesh');
const C = await phone('Chidi Mesh');
await link(A, B);
await A.getByText('Bello Mesh').first().waitFor({ timeout: 15000 });
await link(B, C);
await C.getByText('Bello Mesh').first().waitFor({ timeout: 15000 });
log('A↔B and B↔C linked');

await A.locator('.hdr .ibtn[aria-label="Back"]').click();
await A.locator('.dock button', { hasText: 'Nearby' }).click();
await A.locator('.chip', { hasText: 'Everyone' }).click();
await A.getByText('Chidi Mesh').waitFor({ timeout: 10000 });
log('A discovered C through B');
await A.getByText('Chidi Mesh').click();
await A.fill('.composer textarea', 'hello C, relayed by B');
await A.keyboard.press('Enter');
await C.locator('.hdr .ibtn[aria-label="Back"]').click();
await C.getByText('hello C, relayed by B').first().waitFor({ timeout: 10000 });
log('A→C message delivered over two hops');
await C.getByText('Amaka Mesh').first().click();
await C.fill('.composer textarea', 'got it A');
await C.keyboard.press('Enter');
await A.getByText('got it A').waitFor({ timeout: 10000 });
log('C→A reply delivered');
const leaked = await B.evaluate(() => document.body.innerText.includes('relayed by B'));
if (leaked) throw new Error('relay phone displayed the message');
log('B relayed without being able to read it');

console.log(errors.length ? '\nERRORS:\n' + errors.join('\n') : '\nNo page errors');
await browser.close();
process.exit(errors.length ? 1 : 0);
