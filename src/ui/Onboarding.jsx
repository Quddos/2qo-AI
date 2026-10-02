import { useState } from 'preact/hooks';
import { createProfile } from '../lib/core.js';
import { parse, formatPartial } from '../lib/postcode/format.js';
import { whereAmI } from '../lib/postcode/client.js';
import { smallAvatar } from '../lib/media.js';
import { Avatar, Field, Icon, Logo } from './kit.jsx';
import { askNotifications } from '../lib/notify.js';

export function Onboarding() {
  const [step, setStep] = useState(0);
  const [name, setName] = useState('');
  const [about, setAbout] = useState('');
  const [postcode, setPostcode] = useState('');
  const [avatar, setAvatar] = useState(null);
  const [loc, setLoc] = useState(null);
  const [msg, setMsg] = useState('');
  const [busy, setBusy] = useState(false);
  const pc = postcode ? parse(postcode) : null;

  async function detect() {
    setBusy(true);
    setMsg('Finding your postcode…');
    try {
      const w = await whereAmI();
      setLoc({ lat: w.lat, lng: w.lng });
      if (w.postcode) {
        setPostcode(formatPartial(w.postcode));
        setMsg('Found it ✓');
      } else setMsg(w.message || 'Couldn’t resolve a postcode here — type it in (find yours at docs.postcode.gov.ng / NIPOST).');
    } catch (e) {
      setMsg(e.message);
    }
    setBusy(false);
  }

  async function finish() {
    setBusy(true);
    await createProfile({ name, about: about || 'Hey there! I’m on 2qo.', postcode: pc?.ok ? pc.canonical : '', avatar, lat: loc?.lat ?? null, lng: loc?.lng ?? null });
    askNotifications();
  }

  if (step === 0)
    return (
      <div class="onb">
        <div class="onb-hero">
          <Logo size={56} />
          <h1>Welcome to 2qo</h1>
          <p>Chat, call and get help — even with no data. Your AI lives on your phone, and your postcode connects you to people and services nearby.</p>
        </div>
        <div class="feat">
          <div><b>📴 Offline-first</b>Messages sync over Wi-Fi hotspots, nearby phones or a local 2qo Hub.</div>
          <div><b>🎙️ “Hey 2qo”</b>Run the app with your voice. AI runs on-device.</div>
          <div><b>📍 Postcodes</b>Built on NIPOST’s national digital postcode.</div>
          <div><b>🚨 SOS</b>Record & alert the nearest police station in one command.</div>
          <div><b>🔐 Private</b>End-to-end encrypted. No phone number needed.</div>
          <div><b>👥 Everything</b>Groups, Moments, channels, communities, calls.</div>
        </div>
        <div class="spacer" />
        <button class="btn block" onClick={() => setStep(1)}>
          Get started <Icon name="forward" size={18} />
        </button>
        <p class="muted small center">No phone number or account server. Your identity is a key created on this device.</p>
      </div>
    );

  return (
    <div class="onb">
      <h2 style={{ margin: '8px 0 0' }}>Your profile</h2>
      <p class="muted" style={{ margin: 0 }}>People nearby will see your name and postcode area.</p>
      <div class="avatar-pick">
        <label style={{ cursor: 'pointer' }}>
          <Avatar id={name} name={name || '?'} src={avatar} size={78} />
          <input type="file" accept="image/*" hidden onChange={async (e) => e.target.files[0] && setAvatar(await smallAvatar(e.target.files[0]))} />
        </label>
        <div class="muted small">Tap to add a photo</div>
      </div>
      <Field label="Name">
        <input class="inp" value={name} onInput={(e) => setName(e.target.value)} placeholder="e.g. Amaka Obi" maxLength={40} autoFocus />
      </Field>
      <Field label="About">
        <input class="inp" value={about} onInput={(e) => setAbout(e.target.value)} placeholder="Hey there! I’m on 2qo." maxLength={120} />
      </Field>
      <Field label="Your postcode (optional)" hint={pc && !pc.ok ? <span class="err">{pc.error}</span> : pc?.ok ? <span class="ok">✓ {pc.display}{pc.stateName ? ' · ' + pc.stateName : ''}</span> : 'Format: EK 01 A03 FK 01 — state · LGA · district · area · building'}>
        <div style={{ display: 'flex', gap: 8 }}>
          <input class="inp mono" value={postcode} onInput={(e) => setPostcode(formatPartial(e.target.value))} placeholder="LA 11 W06 TC 10" />
          <button class="btn ghost" onClick={detect} disabled={busy} title="Detect with GPS">
            <Icon name="location" size={18} />
          </button>
        </div>
      </Field>
      {msg && <div class="muted small">{msg}</div>}
      <div class="spacer" />
      <button class="btn block" disabled={!name.trim() || busy || (pc && !pc.ok)} onClick={finish}>
        Create my 2qo
      </button>
    </div>
  );
}
