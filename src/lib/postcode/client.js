// Client for NIPOST's Postcode API (https://docs.postcode.gov.ng).
//   GET  /v1/lookup?code=&level=           graded lookup (L1 free, L2+ need X-API-Key + credits)
//   GET  /v1/search/autocomplete?q=        segment-aware suggestions
//   GET  /v1/search/nearby?lat=&lng=&radius=   units within ≤300 m
//   GET  /v1/search/reverse?lat=&lng=&max_distance_m=   snap a coordinate to the nearest unit
//   POST /v1/assembly/assemble             5 segments -> canonical
//   GET  /v1/assembly/disassemble?code=
// Every successful response is cached in IndexedDB so lookups keep working offline.
// When the app is served by a 2qo Hub, calls go through the hub's /api/postcode proxy,
// which keeps the API key server-side and avoids browser CORS limits.
import { get, put, all } from '../db.js';
import { getState } from '../store.js';
import { parse, assemble as assembleOffline, formatPartial, activeSegment, KNOWN_STATES } from './format.js';
import { TEST_POSTCODES } from './samples.js';

const TTL = 30 * 86400000;

function base() {
  const s = getState().settings;
  if (s.postcodeViaHub && getState().net.hub === 'connected') return location.origin + '/api/postcode';
  return (s.postcodeApi || 'https://api.postcode.gov.ng').replace(/\/$/, '');
}

async function call(path, params = {}, { method = 'GET', body, cacheKey, auth = false } = {}) {
  const key = cacheKey || method + ' ' + path + '?' + new URLSearchParams(params);
  const cached = await get('postcodes', key);
  if (cached && Date.now() - cached.at < TTL && navigator.onLine === false) return { ...cached.data, _cached: true };
  try {
    const url = new URL(base() + path);
    Object.entries(params).forEach(([k, v]) => v != null && url.searchParams.set(k, v));
    const headers = { Accept: 'application/json' };
    const apiKey = getState().settings.postcodeKey;
    if (apiKey && auth) headers['X-API-Key'] = apiKey;
    if (body) headers['Content-Type'] = 'application/json';
    const ctl = new AbortController();
    const t = setTimeout(() => ctl.abort(), 8000);
    const res = await fetch(url, { method, headers, body: body && JSON.stringify(body), signal: ctl.signal });
    clearTimeout(t);
    if (!res.ok) {
      const err = new Error(`Postcode API ${res.status}`);
      err.status = res.status;
      throw err;
    }
    const data = await res.json();
    await put('postcodes', { key, at: Date.now(), data });
    return data;
  } catch (e) {
    if (cached) return { ...cached.data, _cached: true };
    throw e;
  }
}

/** Graded lookup. Falls back to offline validation (and bundled test codes) when unreachable. */
export async function lookup(code, level = 1) {
  const p = parse(code);
  if (!p.ok) return { postcode: code, valid: false, error: p.error, _offline: true };
  try {
    return await call('/v1/lookup', { code: p.canonical, level }, { auth: level > 1 });
  } catch (e) {
    const sample = TEST_POSTCODES.find((t) => t.code === p.canonical);
    return {
      postcode: p.canonical,
      valid: true,
      _offline: true,
      _error: e.message,
      administrative_address: {
        state: p.segments.state,
        state_name: sample?.state || KNOWN_STATES[p.segments.state] || undefined,
        lga: p.segments.lga,
        district: p.segments.district,
        area: p.segments.area,
        unit: p.segments.unit,
      },
      recent_house_address: sample ? { address: sample.address } : undefined,
    };
  }
}

export async function autocomplete(q) {
  try {
    return await call('/v1/search/autocomplete', { q });
  } catch {
    // offline: suggest from codes we've seen (cache, contacts, samples)
    const known = await knownCodes();
    const raw = q.toUpperCase().replace(/[^A-Z0-9]/g, '');
    const suggestions = known
      .filter((c) => c.code.replace(/-/g, '').startsWith(raw))
      .slice(0, 8)
      .map((c) => ({ code: c.code, label: c.label || formatPartial(c.code) }));
    return { segment: activeSegment(q), suggestions, _offline: true };
  }
}

export async function reverse(lat, lng, maxDistance = 50) {
  try {
    return await call('/v1/search/reverse', { lat: lat.toFixed(6), lng: lng.toFixed(6), max_distance_m: maxDistance });
  } catch (e) {
    const near = await nearestKnown(lat, lng, 300);
    if (near) return { found: true, unit: { postcode: near.code, display: near.code.replace(/-/g, ' '), distance_m: near.d, confidence: 'cached' }, _offline: true };
    return { found: false, message: navigator.onLine ? e.message : 'Offline — no cached postcode near you yet', _offline: true };
  }
}

export async function nearby(lat, lng, radius = 300) {
  try {
    return await call('/v1/search/nearby', { lat: lat.toFixed(6), lng: lng.toFixed(6), radius });
  } catch {
    return { results: [], _offline: true };
  }
}

export async function assemble(segs) {
  try {
    return await call('/v1/assembly/assemble', {}, { method: 'POST', body: segs, cacheKey: 'assemble ' + JSON.stringify(segs) });
  } catch {
    const p = assembleOffline(segs);
    if (!p.ok) throw new Error(p.error);
    return { postcode: p.canonical, display: p.display, compact: p.compact, _offline: true };
  }
}

/** Remember a postcode at a coordinate so "where am I" works offline next time. */
export async function rememberPlace(code, lat, lng, label) {
  const p = parse(code);
  if (!p.ok) return;
  await put('postcodes', { key: 'geo:' + p.canonical, at: Date.now(), data: { code: p.canonical, lat, lng, label } });
}

async function knownCodes() {
  const rows = await all('postcodes');
  const out = rows.filter((r) => r.key.startsWith('geo:')).map((r) => r.data);
  for (const c of Object.values(getState().contacts)) if (c.postcode) out.push({ code: parse(c.postcode).canonical || c.postcode, label: c.name });
  for (const t of TEST_POSTCODES) out.push({ code: t.code, label: t.address });
  return out;
}

async function nearestKnown(lat, lng, maxM) {
  const rows = (await all('postcodes')).filter((r) => r.key.startsWith('geo:')).map((r) => r.data);
  let best = null;
  for (const r of rows) {
    const d = haversine(lat, lng, r.lat, r.lng);
    if (d <= maxM && (!best || d < best.d)) best = { ...r, d: Math.round(d) };
  }
  return best;
}

export function haversine(lat1, lon1, lat2, lon2) {
  const R = 6371000;
  const toRad = (x) => (x * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}

/** Current position (high accuracy), with a cached last-known fallback for offline use. */
export function locate({ timeout = 12000 } = {}) {
  return new Promise((res, rej) => {
    if (!navigator.geolocation) return rej(new Error('Location is not available on this device'));
    navigator.geolocation.getCurrentPosition(
      (p) => {
        const loc = { lat: p.coords.latitude, lng: p.coords.longitude, accuracy: p.coords.accuracy, at: Date.now() };
        try {
          localStorage.setItem('2qo:lastLoc', JSON.stringify(loc));
        } catch {}
        res(loc);
      },
      (err) => {
        try {
          const last = JSON.parse(localStorage.getItem('2qo:lastLoc'));
          if (last) return res({ ...last, stale: true });
        } catch {}
        rej(new Error(err.code === 1 ? 'Location permission denied' : 'Could not get your location'));
      },
      { enableHighAccuracy: true, timeout, maximumAge: 30000 },
    );
  });
}

/** Locate + resolve postcode in one step. */
export async function whereAmI() {
  const loc = await locate();
  const r = await reverse(loc.lat, loc.lng, 100);
  const code = r.unit?.postcode || null;
  if (code && !r._offline) await rememberPlace(code, loc.lat, loc.lng, r.unit.address || r.unit.display);
  return { ...loc, postcode: code, display: r.unit?.display || null, address: r.unit?.address || null, offline: !!r._offline, message: r.message };
}
