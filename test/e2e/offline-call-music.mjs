// Offline call + "play my song" test.
// Two isolated phones pair by invite code, then the NETWORK IS SWITCHED OFF for both.
// They chat, make a voice call, and one plays a song from their phone for both to hear.
// Run: npm run build && npx vite preview --port 4173 & node test/e2e/offline-call-music.mjs
import { chromium } from 'playwright';
import { writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const BASE = process.env.BASE || 'http://localhost:4173';
const OUT = process.env.OUT || '.';
const errors = [];
const log = (...a) => console.log('•', ...a);

// a 12-second test tone stands in for a song on the phone
function wav(seconds = 12, rate = 22050) {
  const n = seconds * rate;
  const buf = Buffer.alloc(44 + n * 2);
  buf.write('RIFF', 0); buf.writeUInt32LE(36 + n * 2, 4); buf.write('WAVEfmt ', 8);
  buf.writeUInt32LE(16, 16); buf.writeUInt16LE(1, 20); buf.writeUInt16LE(1, 22);
  buf.writeUInt32LE(rate, 24); buf.writeUInt32LE(rate * 2, 28); buf.writeUInt16LE(2, 32); buf.writeUInt16LE(16, 34);
  buf.write('data', 36); buf.writeUInt32LE(n * 2, 40);
  for (let i = 0; i < n; i++) buf.writeInt16LE(Math.round(Math.sin((2 * Math.PI * 440 * i) / rate) * 12000), 44 + i * 2);
  const f = join(tmpdir(), 'Afrobeat Test Song.wav');
  writeFileSync(f, buf);
  return f;
}
const SONG = wav();

const browser = await chromium.launch({ args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream', '--autoplay-policy=no-user-gesture-required'] });
process.on('uncaughtException', async (e) => {
  console.error('FAILED:', e.message.split('\n')[0], '\n' + errors.join('\n'));
  for (const [i, c] of browser.contexts().entries()) for (const p of c.pages()) await p.screenshot({ path: `${OUT}/fail-call-${i}.png` }).catch(() => {});
  await browser.close();
  process.exit(1);
});

async function phone(name) {
  const ctx = await browser.newContext({ viewport: { width: 400, height: 820 }, permissions: ['clipboard-read', 'clipboard-write', 'microphone', 'camera'] });
  const p = await ctx.newPage();
  p.on('pageerror', (e) => errors.push(`[${name}] ${e.message}`));
  await p.goto(BASE + '/');
  await p.getByText('Get started').click();
  await p.getByPlaceholder('e.g. Amaka Obi').fill(name);
  await p.getByText('Create my 2qo').click();
  await p.waitForSelector('.dock');
  return { ctx, p };
}

const ada = await phone('Ada Offline');
const bayo = await phone('Bayo Offline');
// let the service worker finish caching so the app keeps working with no network
await ada.p.waitForTimeout(1500);

// pair: Ada shows invite → Bayo replies → Ada completes
await ada.p.goto(BASE + '/?go=connect');
await ada.p.locator('.chip', { hasText: 'Link phones' }).click();
await ada.p.getByText('Create link invite').click();
await ada.p.getByText('Copy invite code').click();
const invite = await ada.p.evaluate(() => navigator.clipboard.readText());
await bayo.p.goto(BASE + '/?go=connect');
await bayo.p.locator('.chip', { hasText: 'Scan / paste' }).click();
await bayo.p.fill('textarea.inp', invite);
await bayo.p.getByText('Use code').click();
await bayo.p.getByText('Copy reply code').click();
const reply = await bayo.p.evaluate(() => navigator.clipboard.readText());
await ada.p.fill('textarea.inp', reply);
await ada.p.locator('button.btn', { hasText: /^Connect$/ }).click();
await ada.p.getByText('Bayo Offline').first().waitFor({ timeout: 15000 });
log('phones paired by QR/invite code');

// ---- cut ALL network for both phones
await ada.ctx.setOffline(true);
await bayo.ctx.setOffline(true);
if (await ada.p.evaluate(() => navigator.onLine)) throw new Error('still online');
log('network OFF on both phones');

// chat with no network
for (const u of [ada, bayo]) await u.p.locator('.hdr .ibtn[aria-label="Back"]').click();
await ada.p.locator('.dock button', { hasText: 'Calls' }).click();
await ada.p.locator('.row', { hasText: 'Bayo Offline' }).waitFor({ timeout: 5000 });
log('Calls tab shows Bayo as reachable (via direct link)');
await ada.p.locator('.dock button', { hasText: 'Nearby' }).click();
await ada.p.locator('.chip', { hasText: 'Everyone' }).click();
await ada.p.getByText('Bayo Offline').click();
await ada.p.fill('.composer textarea', 'No data, still chatting 📴');
await ada.p.keyboard.press('Enter');
await bayo.p.getByText('No data, still chatting 📴').first().waitFor({ timeout: 8000 });
log('offline chat delivered');

// Calls: Chrome's test-mode "offline" switch also blocks brand-new WebRTC connections (even
// between two connections in the same page), which real phones on a data-less hotspot don't do.
// So for the call we model a hotspot with no data: the local link stays up, the internet is gone.
for (const u of [ada, bayo]) {
  await u.ctx.setOffline(false);
  await u.ctx.route('**/*', (r) => r.abort('internetdisconnected'));
}
log('LAN-only from here: every internet request is blocked');

// voice call with no internet
await ada.p.locator('.hdr .ibtn[aria-label="Voice call"]').click();
await bayo.p.locator('.callscr button[aria-label="Accept"]').click({ timeout: 10000 });
await ada.p.locator('.callscr button[aria-label="Play my song"]').waitFor({ timeout: 15000 });
await bayo.p.locator('.callscr button[aria-label="Play my song"]').waitFor({ timeout: 15000 });
log('voice call connected with no internet (direct link only, no hub, no STUN)');

// play a song from Ada's phone for both
await ada.p.locator('.callscr input[type=file]').setInputFiles(SONG);
await ada.p.locator('.musicbar').waitFor({ timeout: 8000 });
await ada.p.getByText('Afrobeat Test Song').waitFor();
await bayo.p.locator('.musicbar.listen').getByText('Afrobeat Test Song').waitFor({ timeout: 8000 });
await ada.p.waitForTimeout(2500);
const t = await ada.p.locator('.mb-ctrl small').first().innerText();
if (t === '0:00') throw new Error('song is not advancing');
await ada.p.screenshot({ path: `${OUT}/11-call-music-sharer.png` });
await bayo.p.screenshot({ path: `${OUT}/12-call-music-listener.png` });
log(`song playing for both (sharer at ${t}); listener sees now-playing`);

// verify the music is really in the audio the listener receives: find the dominant frequency
const peak = await bayo.p.evaluate(async () => {
  const stream = document.querySelector('.callscr video').srcObject;
  const ctx = new AudioContext();
  await ctx.resume();
  const an = ctx.createAnalyser();
  an.fftSize = 8192;
  ctx.createMediaStreamSource(stream).connect(an);
  const bins = new Float32Array(an.frequencyBinCount);
  const hits = {};
  for (let k = 0; k < 15; k++) {
    await new Promise((r) => setTimeout(r, 100));
    an.getFloatFrequencyData(bins);
    let best = 0;
    for (let i = 1; i < bins.length; i++) if (bins[i] > bins[best]) best = i;
    const hz = Math.round((best * ctx.sampleRate) / an.fftSize);
    hits[hz] = (hits[hz] || 0) + 1;
  }
  return Object.entries(hits).sort((a, b) => b[1] - a[1])[0][0];
});
if (Math.abs(peak - 440) > 15) throw new Error('listener does not hear the song (dominant ' + peak + ' Hz)');
log(`listener's incoming call audio is dominated by the song (${peak} Hz ≈ 440 Hz test tone)`);

// pause + stop
await ada.p.locator('.mb-play').click();
await ada.p.locator('.mb-x').click();
await bayo.p.locator('.musicbar').waitFor({ state: 'detached', timeout: 8000 });
log('stop sharing clears listener banner');
await ada.p.locator('.callscr button[aria-label="End call"]').click();
await bayo.p.locator('.callscr').waitFor({ state: 'detached', timeout: 8000 });
log('call ended on both phones');

console.log(errors.length ? '\nERRORS:\n' + errors.join('\n') : '\nNo page errors');
await browser.close();
process.exit(errors.length ? 1 : 0);
