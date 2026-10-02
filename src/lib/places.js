// Emergency & civic places near the user (police, hospitals, fire, pharmacies).
// Source: OpenStreetMap via the Overpass API when online; every result is cached in
// IndexedDB per area so the nearest station can still be found offline.
// Users can also add places by hand. Organisation accounts on 2qo (e.g. a police division)
// only receive SOS alerts after the user explicitly marks them as trusted — anyone can *claim*
// to be a station, so a self-declared label alone is never enough to receive someone's location.
import { all, put, del } from './db.js';
import { getState } from './store.js';
import { haversine } from './postcode/client.js';
import { uid } from './crypto.js';

export const KINDS = {
  police: { label: 'Police', icon: '🚓', osm: 'amenity=police' },
  hospital: { label: 'Hospital / clinic', icon: '🏥', osm: 'amenity~"^(hospital|clinic)$"' },
  fire: { label: 'Fire service', icon: '🚒', osm: 'amenity=fire_station' },
  pharmacy: { label: 'Pharmacy', icon: '💊', osm: 'amenity=pharmacy' },
};

const OVERPASS = 'https://overpass-api.de/api/interpreter';

function query(kind, lat, lng, radius) {
  const [k, v] = KINDS[kind].osm.includes('~') ? KINDS[kind].osm.split('~') : KINDS[kind].osm.split('=');
  const sel = KINDS[kind].osm.includes('~') ? `["${k}"~${v}]` : `["${k}"="${v}"]`;
  return `[out:json][timeout:20];(node${sel}(around:${radius},${lat},${lng});way${sel}(around:${radius},${lat},${lng}););out center tags 40;`;
}

async function fetchOSM(kind, lat, lng, radius) {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), 15000);
  const res = await fetch(OVERPASS, { method: 'POST', body: 'data=' + encodeURIComponent(query(kind, lat, lng, radius)), signal: ctl.signal, headers: { 'Content-Type': 'application/x-www-form-urlencoded' } });
  clearTimeout(t);
  if (!res.ok) throw new Error('Map service ' + res.status);
  const data = await res.json();
  const out = [];
  for (const el of data.elements || []) {
    const plat = el.lat ?? el.center?.lat;
    const plng = el.lon ?? el.center?.lon;
    if (plat == null) continue;
    const tg = el.tags || {};
    const place = {
      id: `osm:${el.type}/${el.id}`,
      kind,
      name: tg.name || tg['official_name'] || KINDS[kind].label,
      phone: tg.phone || tg['contact:phone'] || null,
      address: [tg['addr:housenumber'], tg['addr:street'], tg['addr:city']].filter(Boolean).join(' ') || null,
      lat: plat,
      lng: plng,
      source: 'OpenStreetMap',
      at: Date.now(),
    };
    out.push(place);
    await put('places', place);
  }
  return out;
}

/** Nearest places of a kind. Tries the network, always merges cached + manual + 2qo org accounts. */
export async function nearest(kind, lat, lng, { radius = 15000, limit = 10 } = {}) {
  let online = false;
  let error = null;
  if (navigator.onLine) {
    try {
      await fetchOSM(kind, lat, lng, radius);
      online = true;
    } catch (e) {
      error = e.message;
    }
  }
  const cached = (await all('places')).filter((p) => p.kind === kind);
  const orgs = Object.values(getState().contacts)
    .filter((c) => c.isOrg && c.orgTrusted && c.orgType === kind && c.lat != null)
    .map((c) => ({ id: 'org:' + c.id, kind, name: c.name, contactId: c.id, postcode: c.postcode, lat: c.lat, lng: c.lng, source: '2qo account (trusted by you)' }));
  const list = [...orgs, ...cached]
    .map((p) => ({ ...p, distance: haversine(lat, lng, p.lat, p.lng) }))
    .sort((a, b) => a.distance - b.distance);
  const dedup = [];
  for (const p of list) if (!dedup.some((d) => d.id === p.id)) dedup.push(p);
  return { places: dedup.slice(0, limit), online, error };
}

export async function addPlace({ kind, name, phone, postcode, lat, lng, contactId }) {
  const p = { id: 'manual:' + uid(6), kind, name, phone, postcode, lat, lng, contactId, source: 'Added by you', at: Date.now() };
  await put('places', p);
  return p;
}

export const removePlace = (id) => del('places', id);
export const allPlaces = () => all('places');

export function fmtDistance(m) {
  if (m == null || !isFinite(m)) return '';
  return m < 1000 ? `${Math.round(m)} m` : `${(m / 1000).toFixed(m < 10000 ? 1 : 0)} km`;
}

export const mapsLink = (lat, lng) => `https://maps.google.com/?q=${lat.toFixed(6)},${lng.toFixed(6)}`;
export const osmLink = (lat, lng) => `https://www.openstreetmap.org/?mlat=${lat.toFixed(6)}&mlon=${lng.toFixed(6)}#map=18/${lat.toFixed(6)}/${lng.toFixed(6)}`;
