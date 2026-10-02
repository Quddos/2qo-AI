// End-to-end smoke test: two profiles in one browser talk over the local bus.
// Run: npm run build && npx vite preview --port 4173 & node test/e2e/two-users.mjs
import { chromium } from 'playwright';

const BASE = process.env.BASE || 'http://localhost:4173';
const OUT = process.env.OUT || '.';
const browser = await chromium.launch({ args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream'] });
const ctx = await browser.newContext({ viewport: { width: 400, height: 820 }, geolocation: { latitude: 6.6018, longitude: 3.3515 }, permissions: ['geolocation', 'microphone', 'camera'] });
const errors = [];
const log = (...a) => console.log('•', ...a);

async function open(name) {
  const p = await ctx.newPage();
  p.on('pageerror', (e) => errors.push(`[${name}] ${e.message}`));
  p.on('console', (m) => process.env.VERBOSE && console.log(`[${name}]`, m.text()));
  p.on('console', (m) => m.type() === 'error' && !/Failed to load resource|ERR_|net::|postcode|overpass/i.test(m.text()) && errors.push(`[${name}] console: ${m.text()}`));
  await p.goto(`${BASE}/?as=${name}`);
  return p;
}

async function onboard(p, name, postcode) {
  await p.getByText('Get started').click();
  await p.getByPlaceholder('e.g. Amaka Obi').fill(name);
  await p.getByPlaceholder('LA 11 W06 TC 10').fill(postcode);
  await p.getByText('Create my 2qo').click();
  await p.waitForSelector('.dock');
}

process.on('uncaughtException', async (e) => {
  console.error('FAILED:', e.message.split('\n')[0]);
  for (const [i, pg] of ctx.pages().entries()) await pg.screenshot({ path: `${OUT}/fail-${i}.png` }).catch(() => {});
  console.error(errors.join('\n'));
  await browser.close();
  process.exit(1);
});

const ada = await open('ada');
await onboard(ada, 'Ada Obi', 'la11w06tc10');
await ada.screenshot({ path: `${OUT}/01-chats.png` });
log('Ada onboarded');

const bayo = await open('bayo');
await onboard(bayo, 'Bayo Adeyemi', 'LA 11 W06 TC 11');
log('Bayo onboarded');
await ada.waitForTimeout(800);

// Nearby → people in my area
await ada.locator('.dock button', { hasText: 'Nearby' }).click();
await ada.getByText('Bayo Adeyemi').waitFor({ timeout: 5000 });
await ada.screenshot({ path: `${OUT}/02-nearby.png` });
log('Ada sees Bayo in Nearby (same area)');
await ada.getByText('Bayo Adeyemi').click();
await ada.waitForSelector('.composer textarea');
await ada.fill('.composer textarea', 'Hello Bayo 👋 this is 2qo');
await ada.click('.sendbtn');
log('Ada sent message');

// Bayo receives it
await bayo.waitForTimeout(1000);
await bayo.getByText('Hello Bayo 👋 this is 2qo').first().waitFor({ timeout: 5000 });
log('Bayo sees message in chat list');
await bayo.getByText('Ada Obi').first().click();
await bayo.waitForSelector('.composer textarea');
await bayo.fill('.composer textarea', 'Ah Ada! How far?');
await bayo.keyboard.press('Enter');
await bayo.waitForTimeout(800);

// Ada should see reply + read ticks on her message
await ada.getByText('Ah Ada! How far?').waitFor({ timeout: 5000 });
await ada.waitForSelector('.msg.me .read', { timeout: 5000 });
log('Ada got reply and blue (read) ticks');
await ada.screenshot({ path: `${OUT}/03-chat.png` });

// Reaction from Bayo
await bayo.locator('.msg.them .bub').first().dblclick();
await ada.waitForSelector('.reacts', { timeout: 5000 });
log('Reaction delivered');

// AI agent sends a message on Ada's behalf
await ada.goto(`${BASE}/?as=ada&go=ai`);
await ada.waitForSelector('.ai-hero');
await ada.fill('.composer textarea', 'send Bayo a message that I am on my way');
await ada.keyboard.press('Enter');
await ada.getByText('Sent to Bayo Adeyemi').waitFor({ timeout: 5000 });
await bayo.getByText('I am on my way').waitFor({ timeout: 5000 });
log('AI agent sent message and Bayo received it');
await ada.fill('.composer textarea', 'check LA 11 W06 TC 10');
await ada.keyboard.press('Enter');
await ada.getByText(/is valid/).waitFor({ timeout: 12000 });
log('AI validated a postcode');
await ada.screenshot({ path: `${OUT}/04-ai.png` });

// Group
await bayo.goto(`${BASE}/?as=bayo`);
await bayo.waitForSelector('.dock');
await ada.goto(`${BASE}/?as=ada&go=newgroup`);
await ada.getByText('Bayo Adeyemi').click();
await ada.click('.fab');
await ada.getByRole('textbox').first().fill('Ikeja Estate');
await ada.getByText('Create', { exact: true }).click();
await ada.waitForSelector('.composer textarea');
await ada.fill('.composer textarea', 'Welcome to the estate group');
await ada.keyboard.press('Enter');
await bayo.getByText('Ikeja Estate').first().waitFor({ timeout: 6000 });
log('Group created and delivered to Bayo');

// Moments
await ada.goto(`${BASE}/?as=ada&go=moments`);
await ada.getByText('Text', { exact: true }).click();
await ada.fill('.composer-status textarea', 'Market day in Ikeja!');
await ada.click('.composer-status .sendbtn');
await ada.waitForTimeout(500);
await ada.screenshot({ path: `${OUT}/05-moments.png` });
log('Moment posted');

// SOS screen
await ada.goto(`${BASE}/?as=ada&go=sos`);
await ada.waitForSelector('.sos-big');
await ada.screenshot({ path: `${OUT}/06-sos.png` });

// Make Bayo an emergency contact, then trigger SOS with a natural-language command
await ada.goto(`${BASE}/?as=ada&go=settings`);
await ada.getByText('Emergency contacts').click();
await ada.locator('.sheet .menu-i', { hasText: 'Bayo' }).click();
await ada.locator('.sheet .btn', { hasText: 'Done' }).click();
await ada.waitForTimeout(500); // let the settings write commit before navigating
await ada.goto(`${BASE}/?as=ada&go=ai`);
await ada.fill('.composer textarea', 'record my situation and send it to the nearest police station');
await ada.keyboard.press('Enter');
await ada.waitForSelector('.sos-ov', { timeout: 8000 });
await ada.waitForTimeout(2500);
await ada.screenshot({ path: `${OUT}/08-sos-running.png` });
await ada.getByText('Send now').click();
await ada.getByText('Alert sent').waitFor({ timeout: 20000 });
await ada.screenshot({ path: `${OUT}/09-sos-done.png` });
const sms = await ada.locator('a', { hasText: 'Send SMS' }).getAttribute('href');
if (!sms.startsWith('sms:112') || !decodeURIComponent(sms).includes('2qo SOS')) throw new Error('bad SMS link ' + sms);
log('SOS ran: recorded, located, prepared SMS to 112');
await bayo.getByText('2qo SOS').first().waitFor({ timeout: 8000 });
log('Bayo (emergency contact) received the SOS alert');
await ada.getByText('Done', { exact: true }).click();

// Render every screen once and make sure nothing throws
for (const r of ['chats', 'moments', 'ai', 'calls', 'nearby', 'settings', 'profile', 'connect', 'sos', 'channels', 'communities', 'starred', 'archived', 'search', 'postcode', 'newchat', 'newgroup']) {
  await ada.goto(`${BASE}/?as=ada&go=${r}`);
  await ada.waitForSelector('.hdr', { timeout: 8000 });
}
await ada.goto(`${BASE}/?as=ada&go=nearby`);
for (const t of ['Services', 'My postcode']) {
  await ada.locator('.chip', { hasText: t }).click();
  await ada.waitForTimeout(300);
}
await ada.goto(`${BASE}/?as=ada&go=connect`);
for (const t of ['Scan / paste', 'Link phones', 'Hub', 'Status']) await ada.locator('.chip', { hasText: t }).click();
await ada.goto(`${BASE}/?as=ada&go=chats`);
await ada.getByText('Ikeja Estate').click();
await ada.locator('.hdr-t').click();
await ada.locator('.sect h4', { hasText: 'Members' }).waitFor();
await ada.screenshot({ path: `${OUT}/10-group-info.png` });
log('All screens render');

// Offline reload: app shell must load from the service worker
await ada.goto(`${BASE}/?as=ada`);
await ada.waitForTimeout(1500);
await ctx.setOffline(true);
await ada.reload();
await ada.waitForSelector('.dock', { timeout: 8000 });
await ada.getByText('Offline mode').first().waitFor({ timeout: 5000 });
await ada.screenshot({ path: `${OUT}/07-offline.png` });
log('App boots offline from service worker');
await ctx.setOffline(false);

console.log(errors.length ? '\nERRORS:\n' + errors.join('\n') : '\nNo page errors');
await browser.close();
process.exit(errors.length ? 1 : 0);
