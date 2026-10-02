import { useEffect, useState } from 'preact/hooks';
import { useStore, go, toast, getState } from '../lib/store.js';
import * as core from '../lib/core.js';
import { Avatar, Header, Icon, IconBtn, Empty, Row, Section, Field, PostcodeChip } from './kit.jsx';
import { NetPill } from './Chats.jsx';
import { parse, proximity, PROXIMITY_LABEL, formatPartial, display as pcDisplay, activeSegment } from '../lib/postcode/format.js';
import { whereAmI, lookup, autocomplete, locate, haversine, nearby as apiNearby } from '../lib/postcode/client.js';
import { TEST_POSTCODES } from '../lib/postcode/samples.js';
import { nearest, KINDS, fmtDistance, mapsLink, addPlace } from '../lib/places.js';
import { fingerprint } from '../lib/crypto.js';

const LEVELS = [
  [4, 'My area'],
  [3, 'District'],
  [2, 'LGA'],
  [1, 'State'],
];

export function Nearby() {
  const [tab, setTab] = useState('people');
  return (
    <div class="screen">
      <header class="hdr">
        <div class="brand"><b style={{ fontSize: '1.35rem' }}>Nearby</b></div>
        <div class="spacer" />
        <NetPill />
        <IconBtn name="location" label="Postcode tools" onClick={() => go('postcode')} />
      </header>
      <div class="chips">
        {[['people', '👥 People'], ['places', '🏥 Services'], ['postcode', '📍 My postcode']].map(([k, l]) => (
          <button class={'chip' + (tab === k ? ' on' : '')} onClick={() => setTab(k)}>{l}</button>
        ))}
      </div>
      <div class="scroll with-dock">
        {tab === 'people' && <People />}
        {tab === 'places' && <Places />}
        {tab === 'postcode' && <MyPostcode />}
      </div>
    </div>
  );
}

function MyPostcode() {
  const me = useStore((s) => s.me);
  const [busy, setBusy] = useState(false);
  const [info, setInfo] = useState(null);
  const p = parse(me.postcode);
  useEffect(() => {
    if (p.ok) lookup(p.canonical, 1).then(setInfo);
  }, [me.postcode]);
  async function detect() {
    setBusy(true);
    try {
      const w = await whereAmI();
      await core.updateProfile({ lat: w.lat, lng: w.lng, ...(w.postcode ? { postcode: w.postcode } : {}) });
      toast(w.postcode ? 'Postcode updated: ' + pcDisplay(w.postcode) : w.message || 'Location saved; no postcode resolved here');
    } catch (e) {
      toast(e.message);
    }
    setBusy(false);
  }
  const a = info?.administrative_address || {};
  return (
    <>
      <Section>
        <div class="pad center">
          {p.ok ? (
            <>
              <div class="muted small">Your postcode</div>
              <div style={{ font: '800 1.9rem ui-monospace,monospace', letterSpacing: '0.06em', margin: '6px 0' }}>{p.display}</div>
              <dl class="kv" style={{ textAlign: 'left', margin: '12px auto', maxWidth: 320 }}>
                <dt>State</dt><dd>{p.segments.state} {a.state_name || p.stateName ? '· ' + (a.state_name || p.stateName) : ''}</dd>
                <dt>LGA</dt><dd>{p.segments.lga} {a.lga_name ? '· ' + a.lga_name : ''}</dd>
                <dt>District</dt><dd>{p.segments.district} {a.district_name ? '· ' + a.district_name : ''}</dd>
                <dt>Area</dt><dd>{p.segments.area} {a.area_name ? '· ' + a.area_name : ''}</dd>
                <dt>Building</dt><dd>{p.segments.unit}</dd>
              </dl>
              {info?._offline && <div class="muted small">Validated offline · names appear when the Postcode API is reachable</div>}
            </>
          ) : (
            <p class="muted">No postcode set. Detect it with GPS or type it in your profile.</p>
          )}
          <div class="btns" style={{ justifyContent: 'center', marginTop: 10 }}>
            <button class="btn" disabled={busy} onClick={detect}><Icon name="location" size={18} /> {busy ? 'Locating…' : 'Detect with GPS'}</button>
            <button class="btn ghost" onClick={() => go('profile')}>Edit</button>
            {p.ok && navigator.share && <button class="btn ghost" onClick={() => navigator.share({ text: `My postcode: ${p.display}` })}>Share</button>}
          </div>
        </div>
      </Section>
      <p class="muted small" style={{ padding: '0 22px' }}>
        Nigeria’s National Digital Alphanumeric Postcode gives every building a code: <b>state · LGA · district · area · building</b>. 2qo uses it to find people and services near you, and to tell responders exactly where you are.
      </p>
    </>
  );
}

function People() {
  const me = useStore((s) => s.me);
  const contacts = useStore((s) => s.contacts);
  const hub = useStore((s) => s.net.hub);
  const [level, setLevel] = useState(2);
  const [remote, setRemote] = useState([]);
  const [q, setQ] = useState('');
  useEffect(() => {
    if (hub !== 'connected') return;
    core.net.hub.search({ postcode: me.postcode, level, lat: me.lat, lng: me.lng, q }).then(async (rows) => {
      const ok = [];
      for (const r of rows) if (r.publicJwk && (await fingerprint(r.publicJwk)) === r.id && r.id !== me.id) ok.push(r);
      setRemote(ok);
    });
  }, [hub, level, q, me.postcode]);

  const merged = new Map();
  for (const c of [...Object.values(contacts), ...remote]) {
    if (c.blocked || c.id === me.id) continue;
    merged.set(c.id, { ...(merged.get(c.id) || {}), ...c });
  }
  const ql = q.toLowerCase();
  const rows = [...merged.values()]
    .map((c) => ({ ...c, prox: proximity(me.postcode, c.postcode), dist: me.lat != null && c.lat != null ? haversine(me.lat, me.lng, c.lat, c.lng) : null }))
    .filter((c) => (me.postcode ? c.prox >= level : true) && (!ql || (c.name || '').toLowerCase().includes(ql)))
    .sort((a, b) => b.prox - a.prox || (a.dist ?? 1e9) - (b.dist ?? 1e9));

  async function open(c) {
    if (!contacts[c.id]) await core.saveContact({ id: c.id, name: c.name, about: c.about, postcode: c.postcode, publicJwk: c.publicJwk, avatar: c.avatar, lat: c.lat, lng: c.lng, saved: false, addedAt: Date.now(), via: 'hub' });
    await core.openDirect(c.id);
    go('chat', { id: c.id });
  }

  return (
    <>
      {!me.postcode && (
        <div class="sys" style={{ margin: '0 16px 10px' }}>Set your postcode (📍 My postcode tab) to see who’s in your area.</div>
      )}
      <div class="chips">
        {LEVELS.map(([l, label]) => (
          <button class={'chip' + (level === l ? ' on' : '')} onClick={() => setLevel(l)}>{label}</button>
        ))}
        <button class={'chip' + (level === 0 ? ' on' : '')} onClick={() => setLevel(0)}>Everyone</button>
      </div>
      <div class="search">
        <Icon name="search" size={18} />
        <input placeholder="Filter by name" value={q} onInput={(e) => setQ(e.target.value)} />
      </div>
      <Section title={hub === 'connected' ? 'On your hub & contacts' : 'Contacts & nearby devices'}>
        {rows.map((c) => (
          <Row
            avatar={<Avatar id={c.id} name={c.name} src={c.avatar} size={44} online={getState().presence[c.id]?.online} />}
            title={<>{c.alias || c.name} {c.isOrg && <span class="pc-chip">✔ {c.orgType || 'org'}</span>}</>}
            sub={<>{c.postcode && <PostcodeChip code={c.postcode} />} {PROXIMITY_LABEL[c.prox]}{c.dist != null ? ' · ~' + fmtDistance(c.dist) : ''}</>}
            right={<Icon name="chat" size={20} />}
            onClick={() => open(c)}
          />
        ))}
        {!rows.length && <Row title="Nobody found at this level yet" sub={hub === 'connected' ? 'Try a wider level.' : 'Connect to a 2qo Hub or link phones directly (Connect) to discover people around you.'} onClick={() => go('connect')} />}
      </Section>
    </>
  );
}

function Places() {
  const [kind, setKind] = useState('police');
  const [state, setStateL] = useState({ loading: true });
  async function load(k = kind) {
    setStateL({ loading: true });
    try {
      const loc = await locate();
      const r = await nearest(k, loc.lat, loc.lng);
      setStateL({ ...r, loc });
    } catch (e) {
      setStateL({ error: e.message, places: [] });
    }
  }
  useEffect(() => void load(kind), [kind]);
  async function add() {
    const name = prompt(`Name of the ${KINDS[kind].label.toLowerCase()}`);
    if (!name) return;
    const phone = prompt('Phone number (optional)') || null;
    const loc = state.loc || (await locate());
    await addPlace({ kind, name, phone, lat: loc.lat, lng: loc.lng });
    toast('Saved for offline use at your current location');
    load();
  }
  return (
    <>
      <div class="chips">
        {Object.entries(KINDS).map(([k, v]) => (
          <button class={'chip' + (kind === k ? ' on' : '')} onClick={() => setKind(k)}>{v.icon} {v.label}</button>
        ))}
      </div>
      {state.loading && <p class="muted center">Searching around you…</p>}
      {state.error && <p class="err center">{state.error}</p>}
      {!state.loading && (
        <Section title={state.online ? 'From OpenStreetMap (saved for offline)' : 'From offline cache'}>
          {(state.places || []).map((p) => (
            <Row
              avatar={<div class="row-ic" style={{ fontSize: 20 }}>{KINDS[p.kind].icon}</div>}
              title={p.name}
              sub={[fmtDistance(p.distance), p.phone, p.source].filter(Boolean).join(' · ')}
              right={
                <div style={{ display: 'flex', gap: 2 }}>
                  {p.phone && <a class="ibtn" href={'tel:' + p.phone} aria-label="Call"><Icon name="phone" size={20} /></a>}
                  {p.contactId && <button class="ibtn" onClick={() => go('chat', { id: p.contactId })} aria-label="Message"><Icon name="chat" size={20} /></button>}
                  <a class="ibtn" href={mapsLink(p.lat, p.lng)} target="_blank" rel="noopener noreferrer" aria-label="Map"><Icon name="location" size={20} /></a>
                </div>
              }
            />
          ))}
          {!state.places?.length && <Row title="Nothing found nearby" sub={state.online ? 'Add one you know below.' : 'Go online once to cache places around you, or add one you know.'} />}
          <Row icon="plus" title={`Add a ${KINDS[kind].label.toLowerCase()} you know`} sub="Saved on your phone at your current location" onClick={add} />
        </Section>
      )}
      <p class="muted small" style={{ padding: '0 22px' }}>Emergency: call <a href={'tel:' + getState().settings.emergencyNumber}>{getState().settings.emergencyNumber}</a> or use <a href="#" onClick={(e) => (e.preventDefault(), go('sos'))}>SOS</a>.</p>
    </>
  );
}

// ------------------------------------------------------------- postcode tool --
export function PostcodeTool({ code: initial = '' }) {
  const me = useStore((s) => s.me);
  const settings = useStore((s) => s.settings);
  const [code, setCode] = useState(formatPartial(initial));
  const [level, setLevel] = useState(1);
  const [res, setRes] = useState(null);
  const [sugs, setSugs] = useState([]);
  const [busy, setBusy] = useState(false);
  const [near, setNear] = useState(null);
  const p = parse(code);

  useEffect(() => {
    if (!code || p.ok) return setSugs([]);
    const t = setTimeout(() => autocomplete(code).then((r) => setSugs(r.suggestions || [])).catch(() => {}), 250);
    return () => clearTimeout(t);
  }, [code]);
  useEffect(() => {
    if (initial && parse(initial).ok) run();
  }, []);

  async function run() {
    if (!p.ok) return;
    setBusy(true);
    setRes(await lookup(p.canonical, level));
    setBusy(false);
  }
  async function here() {
    setBusy(true);
    try {
      const w = await whereAmI();
      if (w.postcode) setCode(formatPartial(w.postcode));
      else toast(w.message || 'No postcode found at this spot');
      const n = await apiNearby(w.lat, w.lng, 300);
      setNear(n);
    } catch (e) {
      toast(e.message);
    }
    setBusy(false);
  }
  const a = res?.administrative_address || {};
  const h = res?.recent_house_address || {};
  return (
    <div class="screen">
      <Header title="Postcode tools" sub="NIPOST National Digital Postcode" />
      <div class="scroll pad">
        <Field label={`Postcode · typing ${p.ok ? 'complete' : activeSegment(code)}`} hint={code && !p.ok ? <span class="err">{p.error}</span> : p.ok ? <span class="ok">✓ Valid structure · {p.canonical}</span> : 'e.g. LA 11 W06 TC 10'}>
          <div style={{ display: 'flex', gap: 8 }}>
            <input class="inp mono" value={code} onInput={(e) => setCode(formatPartial(e.target.value))} placeholder="AA 99 H77 BB 55" autoFocus onKeyDown={(e) => e.key === 'Enter' && run()} />
            <button class="btn ghost" onClick={here} title="Use my location" disabled={busy}><Icon name="location" size={18} /></button>
          </div>
        </Field>
        {sugs.length > 0 && (
          <div class="card" style={{ marginBottom: 12 }}>
            {sugs.map((s) => <Row title={s.code.replace(/-/g, ' ')} sub={s.label} onClick={() => setCode(formatPartial(s.code))} />)}
          </div>
        )}
        <div class="chips" style={{ padding: '0 0 12px' }}>
          {[1, 2, 3].map((l) => (
            <button class={'chip' + (level === l ? ' on' : '')} onClick={() => setLevel(l)}>Level {l}{l > 1 ? ' 🔑' : ' · free'}</button>
          ))}
        </div>
        {level > 1 && !settings.postcodeKey && <p class="muted small">Levels 2–3 need an API key from NIPOST (register your organisation, submit KYB, request access). Add it in Settings › Postcode API.</p>}
        <button class="btn block" disabled={!p.ok || busy} onClick={run}>{busy ? 'Checking…' : 'Look up'}</button>

        {res && (
          <Section title={res.valid ? 'Result' + (res._offline ? ' (offline)' : res._cached ? ' (cached)' : '') : 'Not valid'}>
            <div class="pad">
              {res.valid ? (
                <dl class="kv">
                  <dt>Postcode</dt><dd>{pcDisplay(res.postcode)}</dd>
                  {a.state && <><dt>State</dt><dd>{a.state} {a.state_name && '· ' + a.state_name}</dd></>}
                  {a.lga && <><dt>LGA</dt><dd>{a.lga} {a.lga_name && '· ' + a.lga_name}</dd></>}
                  {a.district && <><dt>District</dt><dd>{a.district} {a.district_name && '· ' + a.district_name}</dd></>}
                  {a.area && <><dt>Area</dt><dd>{a.area} {a.area_name && '· ' + a.area_name}</dd></>}
                  {a.zone && <><dt>Zone</dt><dd>{a.zone}</dd></>}
                  {(h.address || h.street_name) && <><dt>Address</dt><dd>{h.address || [h.house_number, h.street_name, h.locality_name].filter(Boolean).join(' ')}</dd></>}
                  {res.building_use_status && <><dt>Building use</dt><dd>{res.building_use_status}</dd></>}
                  {me.postcode && <><dt>From you</dt><dd>{PROXIMITY_LABEL[proximity(me.postcode, res.postcode)]}</dd></>}
                </dl>
              ) : (
                <p class="err">{res.error || 'This postcode does not exist.'}</p>
              )}
              {res._offline && <p class="muted small">Couldn’t reach api.postcode.gov.ng ({res._error || 'offline'}). Structure was checked on-device.</p>}
            </div>
          </Section>
        )}
        {near?.results?.length > 0 && (
          <Section title="Buildings within 300 m">
            {near.results.slice(0, 15).map((r) => <Row title={r.display || pcDisplay(r.postcode)} sub={[r.address, r.distance_m != null && Math.round(r.distance_m) + ' m'].filter(Boolean).join(' · ')} onClick={() => setCode(formatPartial(r.postcode))} />)}
          </Section>
        )}
        <Section title="Official test postcodes">
          {TEST_POSTCODES.slice(0, 8).map((t) => <Row title={t.code.replace(/-/g, ' ')} sub={`${t.state} · ${t.address}`} onClick={() => setCode(formatPartial(t.code))} />)}
        </Section>
      </div>
    </div>
  );
}
