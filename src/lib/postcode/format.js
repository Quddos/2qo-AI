// Nigerian National Digital Alphanumeric Postcode — offline parsing & validation.
//
// Structure (11 significant characters, 5 segments):
//   AA 99 H77 BB 55
//   │  │  │   │  └─ building unit within the area   (2 digits, 01-99)
//   │  │  │   └──── area within the district         (2 letters)
//   │  │  └──────── district within the LGA          (3 alphanumeric)
//   │  └─────────── LGA within the state             (2 digits, 01-99)
//   └────────────── state                            (2 letters)
//
// Accepted inputs: "EK 01 A03 FK 01", "EK-01-A03-FK-01", "ek01a03fk01".
// Everything here is pure and runs without network access.

const SEGMENTS = ['state', 'lga', 'district', 'area', 'unit'];
const LENGTHS = [2, 2, 3, 2, 2];

// State codes confirmed by the official test postcodes published on
// docs.postcode.gov.ng. Unknown codes are still accepted structurally;
// names for them are resolved via the Lookup API and cached.
export const KNOWN_STATES = {
  AK: 'Akwa Ibom',
  BA: 'Bauchi',
  EB: 'Ebonyi',
  EK: 'Ekiti',
  EN: 'Enugu',
  FC: 'FCT Abuja',
  JI: 'Jigawa',
  KN: 'Kano',
  LA: 'Lagos',
  NI: 'Niger',
  OG: 'Ogun',
};

const isAlpha = (c) => c >= 'A' && c <= 'Z';
const isDigit = (c) => c >= '0' && c <= '9';

export function compact(input) {
  return String(input || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
}

/**
 * Parse a postcode. Returns { ok, error?, segments?, canonical?, display?, compact? }.
 */
export function parse(input) {
  const raw = compact(input);
  if (raw.length !== 11) {
    return { ok: false, error: 'A postcode has 11 letters/numbers, e.g. EK 01 A03 FK 01' };
  }
  const c = raw.split('');
  if (!isAlpha(c[0]) || !isAlpha(c[1])) return { ok: false, error: 'State must be 2 letters' };
  if (!isDigit(c[2]) || !isDigit(c[3])) return { ok: false, error: 'LGA must be 2 digits' };
  if (raw.slice(2, 4) === '00') return { ok: false, error: 'LGA cannot be 00' };
  for (let i = 4; i < 7; i++) {
    if (!isAlpha(c[i]) && !isDigit(c[i])) return { ok: false, error: 'District must be 3 letters/digits' };
  }
  if (!isAlpha(c[7]) || !isAlpha(c[8])) return { ok: false, error: 'Area must be 2 letters' };
  if (!isDigit(c[9]) || !isDigit(c[10])) return { ok: false, error: 'Building unit must be 2 digits' };
  if (raw.slice(9) === '00') return { ok: false, error: 'Building unit cannot be 00' };

  const segments = {};
  let i = 0;
  SEGMENTS.forEach((name, n) => {
    segments[name] = raw.slice(i, i + LENGTHS[n]);
    i += LENGTHS[n];
  });
  const parts = SEGMENTS.map((s) => segments[s]);
  return {
    ok: true,
    segments,
    canonical: parts.join('-'),
    display: parts.join(' '),
    compact: raw,
    stateName: KNOWN_STATES[segments.state] || null,
  };
}

export const isValid = (input) => parse(input).ok;

export function display(input) {
  const p = parse(input);
  return p.ok ? p.display : String(input || '').toUpperCase().trim();
}

/** Assemble from segments (offline equivalent of POST /v1/assembly/assemble). */
export function assemble({ state, lga, district, area, unit }) {
  return parse([state, lga, district, area, unit].join(''));
}

/**
 * How "close" two postcodes are by shared administrative hierarchy.
 * 5 = same building unit, 4 = same area, 3 = same district, 2 = same LGA,
 * 1 = same state, 0 = different state / invalid.
 */
export function proximity(a, b) {
  const pa = parse(a);
  const pb = parse(b);
  if (!pa.ok || !pb.ok) return 0;
  let score = 0;
  for (const s of SEGMENTS) {
    if (pa.segments[s] !== pb.segments[s]) break;
    score++;
  }
  return score;
}

export const PROXIMITY_LABEL = ['Elsewhere', 'Same state', 'Same LGA', 'Same district', 'Same area', 'Same building'];
export const PROXIMITY_PHRASE = ['in a different state from you', 'in your state', 'in your LGA', 'in your district', 'in your area', 'in your building'];

/** Which segment the user is currently typing (mirrors autocomplete's `segment`). */
export function activeSegment(partial) {
  const n = compact(partial).length;
  let acc = 0;
  for (let i = 0; i < SEGMENTS.length; i++) {
    acc += LENGTHS[i];
    if (n < acc) return SEGMENTS[i];
  }
  return 'unit';
}

/** Format partial input progressively as the user types: "ek01a" -> "EK 01 A". */
export function formatPartial(partial) {
  const raw = compact(partial).slice(0, 11);
  const out = [];
  let i = 0;
  for (const len of LENGTHS) {
    if (i >= raw.length) break;
    out.push(raw.slice(i, i + len));
    i += len;
  }
  return out.join(' ');
}

/** Find a postcode-looking token inside free text (used by the voice agent). */
export function extract(text) {
  const t = String(text || '').toUpperCase();
  const re = /\b([A-Z]{2})[\s-]*(\d{2})[\s-]*([A-Z0-9]{3})[\s-]*([A-Z]{2})[\s-]*(\d{2})\b/g;
  let m;
  while ((m = re.exec(t))) {
    const p = parse(m.slice(1).join(''));
    if (p.ok) return p;
  }
  return null;
}
