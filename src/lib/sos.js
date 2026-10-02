// SOS: "Hey 2qo, record my situation and send it to the nearest police station".
//
// Pipeline (each step degrades gracefully when offline):
//  1. start recording evidence immediately (video or audio)
//  2. get GPS position (falls back to last known position)
//  3. resolve the NIPOST postcode for that position (API → cached → none)
//  4. find the nearest station (2qo verified org accounts → OpenStreetMap → offline cache → manual)
//  5. a short cancellable countdown, so accidental triggers can be stopped
//  6. deliver: encrypted 2qo message with the recording to the station's 2qo account (if it has one)
//     and to the user's emergency contacts; queue in outbox if no link is up; prepare an SMS
//     (works with zero data) and a phone call to the station / national emergency number.
import { getState, setState, toast } from './store.js';
import { put, all } from './db.js';
import { uid } from './crypto.js';
import { startRecording, fileToDataURL } from './media.js';
import { whereAmI, locate } from './postcode/client.js';
import { nearest, KINDS, fmtDistance, mapsLink } from './places.js';
import { openDirect, sendMessage, displayName } from './core.js';
import { display as fmtPostcode } from './postcode/format.js';

let current = null;

function update(patch) {
  current = { ...current, ...patch };
  setState({ sos: current });
}
function step(key, state, detail) {
  const steps = { ...current.steps, [key]: { state, detail } };
  update({ steps });
}

export function cancelSOS() {
  if (!current) return;
  current.cancelled = true;
  current.recorder?.cancel();
  clearInterval(current.timer);
  setState({ sos: null });
  current = null;
  toast('SOS cancelled');
}

export function closeSOS() {
  setState({ sos: null });
  current = null;
}

export async function runSOS({ service = 'police', mode, seconds, note = '' } = {}) {
  if (current && !current.done) return;
  const s = getState().settings;
  mode = mode || s.sosMode || 'video';
  seconds = seconds || s.sosRecordSeconds || 30;
  current = { id: uid(8), service, mode, seconds, note, startedAt: Date.now(), steps: {}, recSeconds: 0, countdown: s.sosCountdown ?? 5, done: false };
  setState({ sos: current });
  if (navigator.vibrate) navigator.vibrate([200, 100, 200]);

  // 1) record
  step('record', 'active', `Recording ${mode}…`);
  let recPromise = null;
  try {
    const rec = await startRecording(mode, { maxSeconds: seconds, onTick: (t) => current && update({ recSeconds: t }) });
    if (!current) return rec.cancel();
    update({ recorder: rec, stream: rec.stream });
    recPromise = rec.finished;
  } catch (e) {
    if (mode === 'video') {
      try {
        const rec = await startRecording('audio', { maxSeconds: seconds, onTick: (t) => current && update({ recSeconds: t }) });
        update({ recorder: rec, mode: 'audio' });
        recPromise = rec.finished;
        step('record', 'active', 'Camera unavailable — recording audio');
      } catch (e2) {
        step('record', 'error', e2.message);
      }
    } else step('record', 'error', e.message);
  }

  // 2+3) locate & postcode (in parallel with recording)
  step('locate', 'active', 'Getting your location…');
  let where = null;
  try {
    where = await whereAmI();
    step('locate', 'ok', where.postcode ? `${fmtPostcode(where.postcode)}${where.offline ? ' (cached)' : ''} · ±${Math.round(where.accuracy || 0)} m` : `GPS ${where.lat.toFixed(5)}, ${where.lng.toFixed(5)}${where.stale ? ' (last known)' : ''}`);
  } catch (e) {
    try {
      const loc = await locate();
      where = { ...loc, postcode: null };
      step('locate', 'ok', `GPS ${loc.lat.toFixed(5)}, ${loc.lng.toFixed(5)}`);
    } catch {
      step('locate', 'error', e.message);
    }
  }
  if (!current) return;
  if (!where?.postcode && getState().me?.postcode && where) where.homePostcode = getState().me.postcode;
  update({ where });

  // 4) nearest station
  step('station', 'active', `Finding nearest ${KINDS[service].label.toLowerCase()}…`);
  let station = null;
  if (where) {
    const { places, error } = await nearest(service, where.lat, where.lng);
    station = places[0] || null;
    update({ station, alternatives: places.slice(1, 4) });
    step('station', station ? 'ok' : 'warn', station ? `${station.name} · ${fmtDistance(station.distance)}${station.contactId ? ' · on 2qo' : ''}` : `${error ? 'Map service unreachable. ' : ''}No station cached nearby — alerting ${s.emergencyNumber || '112'} & your contacts`);
  } else step('station', 'error', 'No location — will alert emergency number & contacts');
  if (!current) return;

  // 5) countdown
  await new Promise((resolve) => {
    let n = current.countdown;
    current.skipCountdown = resolve; // "Send now" ends the countdown early
    if (n <= 0) return resolve();
    update({ counting: n });
    current.timer = setInterval(() => {
      n -= 1;
      if (!current) return resolve();
      update({ counting: n });
      if (n <= 0) {
        clearInterval(current.timer);
        update({ counting: 0 });
        resolve();
      }
    }, 1000);
  });
  if (!current || current.cancelled) return;

  // stop recording early if the user tapped "send now", else wait for max duration
  let rec = null;
  if (recPromise) {
    step('record', 'active', 'Finishing recording…');
    rec = await recPromise;
    step('record', 'ok', `${rec.duration}s ${current.mode} captured`);
  }
  if (!current) return;

  // 6) deliver
  step('send', 'active', 'Sending alert…');
  const text = reportText(where, station, current);
  const smsTo = station?.phone || s.emergencyNumber || '112';
  update({ text, smsHref: `sms:${smsTo}?&body=${encodeURIComponent(text)}`, telHref: `tel:${station?.phone || s.emergencyNumber || '112'}`, rec });
  const delivered = [];
  const sosPayload = { service, postcode: where?.postcode || null, lat: where?.lat, lng: where?.lng, accuracy: where?.accuracy, station: station && { name: station.name, distance: station.distance } };
  const media = rec ? { blob: rec.blob, mime: rec.mime, name: `sos-${current.id}.${rec.mime.includes('mp4') ? 'mp4' : 'webm'}`, duration: rec.duration, dataUrl: await fileToDataURL(rec.blob) } : null;
  const targets = [...new Set([station?.contactId, ...(s.emergencyContacts || [])].filter(Boolean))];
  for (const id of targets) {
    try {
      const chat = await openDirect(id);
      await sendMessage(chat.id, { kind: 'sos', text, sos: sosPayload, media });
      delivered.push(displayName(id));
    } catch (e) {
      console.warn('SOS send failed', e);
    }
  }
  const pres = getState().presence;
  const offline = targets.filter((id) => !(pres[id]?.online && Date.now() - pres[id].lastSeen < 120000));
  step('send', delivered.length ? 'ok' : 'warn', delivered.length ? `Sent to ${delivered.join(', ')}${offline.length ? ` (${offline.map(displayName).join(', ')} not reachable right now — queued, delivers automatically)` : ''}` : 'No 2qo recipients — use SMS / Call below (works without data)');

  const log = { id: current.id, ts: current.startedAt, service, where, station: station && { name: station.name, phone: station.phone, distance: station.distance }, delivered, text, mediaId: null };
  if (rec) {
    const { putBlob } = await import('./db.js');
    log.mediaId = 'sos-' + current.id;
    await putBlob(log.mediaId, rec.blob);
    log.mime = rec.mime;
  }
  await put('sos', log);
  update({ done: true, delivered });
  if (navigator.vibrate) navigator.vibrate(400);
  return log;
}

/** Stop recording now and proceed to sending (skips remaining record time & countdown). */
export function sendNow() {
  if (!current) return;
  clearInterval(current.timer);
  update({ counting: 0, countdown: 0 });
  current.skipCountdown?.();
  current.recorder?.stop();
}

export function reportText(where, station, ctx) {
  const me = getState().me;
  const lines = [`🚨 2qo SOS — ${KINDS[ctx.service].label.toUpperCase()} NEEDED`, `From: ${me?.name || 'a 2qo user'}`];
  if (where?.postcode) lines.push(`Postcode: ${fmtPostcode(where.postcode)}`);
  else if (where?.homePostcode) lines.push(`Home postcode: ${fmtPostcode(where.homePostcode)}`);
  if (where) lines.push(`GPS: ${where.lat.toFixed(5)}, ${where.lng.toFixed(5)} (±${Math.round(where.accuracy || 0)}m)`, mapsLink(where.lat, where.lng));
  if (station) lines.push(`Nearest: ${station.name} (${fmtDistance(station.distance)})`);
  if (ctx.note) lines.push(`Note: ${ctx.note}`);
  lines.push(`Time: ${new Date(ctx.startedAt).toLocaleString()}`);
  return lines.join('\n');
}

export async function sosHistory() {
  return (await all('sos')).sort((a, b) => b.ts - a.ts);
}

export async function shareRecording() {
  const r = current?.rec;
  if (!r) return;
  const file = new File([r.blob], `2qo-sos.${r.mime.includes('mp4') ? 'mp4' : 'webm'}`, { type: r.mime });
  if (navigator.canShare?.({ files: [file] })) await navigator.share({ files: [file], text: current.text, title: '2qo SOS' });
  else toast('Sharing files is not supported here — recording is saved in SOS history');
}
