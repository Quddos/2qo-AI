import { useEffect, useState } from 'preact/hooks';
import { useStore, go, toast, sheet, getState, setState } from '../lib/store.js';
import * as core from '../lib/core.js';
import * as DB from '../lib/db.js';
import { Avatar, Header, Icon, Row, Section, Toggle, Field, Menu, PostcodeChip } from './kit.jsx';
import { hashPin } from '../lib/crypto.js';
import { smallAvatar } from '../lib/media.js';
import { parse, formatPartial } from '../lib/postcode/format.js';
import { whereAmI } from '../lib/postcode/client.js';
import { prepare, detect, WEBLLM_MODELS } from '../lib/ai/llm.js';
import { sttSupported, ttsSupported, speak } from '../lib/ai/voice.js';
import { askNotifications } from '../lib/notify.js';
import { KINDS } from '../lib/places.js';

const set = (patch) => core.updateSettings(patch);

function choose(title, options, current, onPick) {
  sheet(<Menu title={title} items={options.map(([v, l]) => ({ label: (v === current ? '● ' : '○ ') + l, onClick: () => onPick(v) }))} />);
}

export function Settings({ section }) {
  const me = useStore((s) => s.me);
  const s = useStore((x) => x.settings);
  const ai = useStore((x) => x.ai);
  const contacts = useStore((x) => x.contacts);
  const [caps, setCaps] = useState(null);
  useEffect(() => void detect().then(setCaps), []);
  useEffect(() => {
    if (section) setTimeout(() => document.getElementById('set-' + section)?.scrollIntoView({ behavior: 'smooth' }), 50);
  }, [section]);

  async function setPin() {
    const pin = prompt('New 4–8 digit PIN for locked chats');
    if (!pin) return;
    if (!/^\d{4,8}$/.test(pin)) return toast('PIN must be 4–8 digits');
    if (prompt('Confirm PIN') !== pin) return toast('PINs didn’t match');
    await set({ pin: await hashPin(pin) });
    toast('PIN set');
  }

  async function exportBackup() {
    const data = await DB.exportBackup();
    const blob = new Blob([JSON.stringify(data)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `2qo-backup-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    toast('Backup saved. Note: your encryption key stays on this device.');
  }
  function importBackup() {
    const i = document.createElement('input');
    i.type = 'file';
    i.accept = 'application/json';
    i.onchange = async () => {
      try {
        await DB.importBackup(JSON.parse(await i.files[0].text()));
        toast('Restored — reloading');
        setTimeout(() => location.reload(), 800);
      } catch (e) {
        toast(e.message);
      }
    };
    i.click();
  }

  const saved = Object.values(contacts).filter((c) => c.saved);
  const blocked = Object.values(contacts).filter((c) => c.blocked);

  return (
    <div class="screen">
      <Header title="Settings" />
      <div class="scroll">
        <Section>
          <Row avatar={<Avatar id={me.id} name={me.name} src={me.avatar} size={58} />} title={me.name} sub={<>{me.postcode && <PostcodeChip code={me.postcode} />} {me.about}</>} onClick={() => go('profile')} right={<Icon name="qr" />} />
        </Section>

        <Section title="Privacy">
          <Row icon="eye" title="Last seen & online" sub={s.lastSeen === 'nobody' ? 'Nobody' : 'Everyone'} onClick={() => choose('Last seen', [['everyone', 'Everyone'], ['nobody', 'Nobody']], s.lastSeen, (v) => set({ lastSeen: v }))} />
          <Row icon="check2" title="Read receipts" sub="If off, you won’t send or see blue ticks" right={<Toggle checked={s.readReceipts} onChange={(v) => set({ readReceipts: v })} />} />
          <Row icon="moments" title="Moments privacy" sub={{ contacts: 'My contacts', except: 'My contacts except…', only: 'Only share with…' }[s.statusPrivacy]} onClick={() => choose('Who sees my Moments', [['contacts', 'My contacts'], ['except', 'My contacts except…'], ['only', 'Only share with…']], s.statusPrivacy, (v) => {
            set({ statusPrivacy: v });
            if (v !== 'contacts') pickContacts(v === 'except' ? 'Hide my Moments from' : 'Share my Moments with', v === 'except' ? s.statusExcept || [] : s.statusOnly || [], (ids) => set(v === 'except' ? { statusExcept: ids } : { statusOnly: ids }));
          })} />
          <Row icon="lock" title="Chat lock PIN" sub={s.pin ? 'Set · tap to change' : 'Not set'} onClick={setPin} right={s.pin ? <button class="btn ghost" style={{ padding: '6px 10px' }} onClick={(e) => (e.stopPropagation(), set({ pin: null }), toast('PIN removed'))}>Remove</button> : null} />
          <Row icon="shield" title={`Blocked (${blocked.length})`} onClick={() => sheet(<Menu title="Blocked — tap to unblock" items={blocked.length ? blocked.map((c) => ({ icon: 'user', label: c.name, onClick: () => core.saveContact({ ...c, blocked: false }) })) : [{ label: 'Nobody blocked', onClick: () => {} }]} />)} />
          <Row icon="key" title="Encryption" sub="Every chat and call is end-to-end encrypted (ECDH P-256 + AES-GCM). Keys never leave this device." />
        </Section>

        <Section title="Chats & appearance">
          <Row icon="sun" title="Theme" sub={{ auto: 'System', light: 'Light', dark: 'Dark' }[s.theme]} onClick={() => choose('Theme', [['auto', 'System'], ['light', 'Light'], ['dark', 'Dark']], s.theme, (v) => set({ theme: v }))} />
          <Row icon="sparkle" title="Accent colour" sub={s.accent} onClick={() => choose('Accent', [['sun', 'Violet & sun'], ['leaf', 'Leaf'], ['ocean', 'Ocean'], ['coral', 'Coral']], s.accent, (v) => set({ accent: v }))} />
          <Row icon="edit" title="Font size" sub={s.fontSize + 'px'} onClick={() => choose('Font size', [[14, 'Small'], [16, 'Medium'], [18, 'Large'], [20, 'Extra large']], s.fontSize, (v) => set({ fontSize: v }))} />
          <Row icon="image" title="Default wallpaper" sub={s.wallpaper} onClick={() => choose('Wallpaper', [['grid', 'Dots'], ['waves', 'Waves'], ['sun', 'Sunrise'], ['plain', 'Plain']], s.wallpaper, (v) => set({ wallpaper: v }))} />
          <Row icon="send" title="Enter key sends" right={<Toggle checked={s.enterToSend} onChange={(v) => set({ enterToSend: v })} />} />
          <Row icon="archive" title="Archived chats" onClick={() => go('archived')} />
          <Row icon="star" title="Starred messages" onClick={() => go('starred')} />
        </Section>

        <Section title="Notifications">
          <Row icon="bell" title="Message notifications" right={<Toggle checked={s.notifications} onChange={async (v) => { if (v) await askNotifications(); set({ notifications: v }); }} />} />
        </Section>

        <div id="set-ai" />
        <Section title="2qo AI & voice">
          <Row icon="sparkle" title="AI engine" sub={{ auto: 'Automatic (best on-device)', chrome: 'Chrome on-device AI (Gemini Nano)', webllm: 'Downloadable local model (WebLLM)', rules: 'Command engine only (smallest)' }[s.aiEngine] + ` · now: ${ai.engine} ${ai.engineStatus}`} onClick={() => choose('AI engine', [['auto', 'Automatic'], ['chrome', 'Chrome on-device AI' + (caps ? ` (${caps.chrome})` : '')], ['webllm', 'Local model via WebGPU' + (caps && !caps.webgpu ? ' (no WebGPU here)' : '')], ['rules', 'Command engine only']], s.aiEngine, (v) => set({ aiEngine: v }).then(() => prepare(v)))} />
          {s.aiEngine === 'webllm' && <Row icon="download" title="Local model" sub={(WEBLLM_MODELS.find((m) => m.id === s.webllmModel) || WEBLLM_MODELS[0]).label} onClick={() => choose('Model', WEBLLM_MODELS.map((m) => [m.id, m.label]), s.webllmModel || WEBLLM_MODELS[0].id, (v) => set({ webllmModel: v }).then(() => prepare('webllm')))} />}
          {ai.note && <Row icon="info" title={ai.note} />}
          {ai.engineStatus === 'downloading' && <div class="pad"><div class="progress"><b style={{ width: (ai.progress || 0) * 100 + '%' }} /></div></div>}
          <Row icon="mic" title="“Hey 2qo” wake word" sub={sttSupported ? 'Listens for “Hey 2qo” while the app is open' : 'Not supported in this browser'} right={<Toggle checked={s.wakeWord} onChange={(v) => set({ wakeWord: v })} />} />
          <Row icon="speaker" title="Spoken replies" sub={ttsSupported ? 'Uses on-device voices' : 'Not supported'} right={<Toggle checked={s.voiceReplies} onChange={(v) => set({ voiceReplies: v })} />} />
          <Row icon="globe" title="Voice language" sub={s.language} onClick={() => choose('Language', [['en-NG', 'English (Nigeria)'], ['en-GB', 'English (UK)'], ['en-US', 'English (US)'], ['yo-NG', 'Yorùbá'], ['ha-NG', 'Hausa'], ['ig-NG', 'Igbo'], ['fr-FR', 'Français']], s.language, (v) => set({ language: v }).then(() => speak('2qo AI ready', { lang: v })))} />
        </Section>

        <div id="set-sos" />
        <Section title="SOS & emergency">
          <Row icon="phone" title="Emergency number" sub={s.emergencyNumber} onClick={() => { const n = prompt('Emergency number (Nigeria national: 112)', s.emergencyNumber); if (n) set({ emergencyNumber: n.trim() }); }} />
          <Row icon="users" title="Emergency contacts" sub={(s.emergencyContacts || []).map((id) => core.displayName(id)).join(', ') || 'None'} onClick={() => pickContacts('Emergency contacts', s.emergencyContacts || [], (ids) => set({ emergencyContacts: ids }), saved)} />
          <Row icon="video" title="Default recording" sub={s.sosMode} onClick={() => choose('Record', [['video', 'Video'], ['audio', 'Audio only']], s.sosMode, (v) => set({ sosMode: v }))} />
          <Row icon="timer" title="Recording length" sub={s.sosRecordSeconds + ' s'} onClick={() => choose('Length', [[15, '15 s'], [30, '30 s'], [60, '1 min'], [120, '2 min']], s.sosRecordSeconds, (v) => set({ sosRecordSeconds: v }))} />
          <Row icon="clock" title="Cancel countdown" sub={s.sosCountdown + ' s'} onClick={() => choose('Countdown', [[0, 'None'], [3, '3 s'], [5, '5 s'], [10, '10 s']], s.sosCountdown, (v) => set({ sosCountdown: v }))} />
        </Section>

        <Section title="Postcode API (NIPOST)">
          <Row icon="globe" title="API base URL" sub={s.postcodeApi} onClick={() => { const u = prompt('Postcode API base URL', s.postcodeApi); if (u) set({ postcodeApi: u.trim() }); }} />
          <Row icon="key" title="API key (X-API-Key)" sub={s.postcodeKey ? '••••' + s.postcodeKey.slice(-4) : 'Not set — Level 1 lookups & search are free'} onClick={() => { const k = prompt('API key from your NIPOST organisation account (staging or production)', s.postcodeKey); if (k !== null) set({ postcodeKey: k.trim() }); }} />
          <Row icon="hub" title="Route through 2qo Hub" sub="Keeps the key on the hub and avoids browser limits" right={<Toggle checked={!!s.postcodeViaHub} onChange={(v) => set({ postcodeViaHub: v })} />} />
          <Row icon="location" title="Postcode tools" onClick={() => go('postcode')} />
        </Section>

        <Section title="Organisation account">
          <Row icon="shield" title={me.isOrg ? `Registered as ${KINDS[me.orgType]?.label}` : 'I am a police station / hospital / fire service'} sub="Service accounts share their exact location so citizens nearby can find and trust them" onClick={() => choose('Service type', [[null, 'Not an organisation'], ...Object.entries(KINDS).map(([k, v]) => [k, v.label])], me.orgType || null, (v) => core.updateProfile({ isOrg: !!v, orgType: v }).then(() => v && toast('Citizens must still mark you as trusted before receiving their SOS alerts.')))} />
        </Section>

        <Section title="Storage & backup">
          <Row icon="download" title="Export backup" sub="Chats, media & settings as a file" onClick={exportBackup} />
          <Row icon="upload" title="Restore backup" onClick={importBackup} />
          <Row icon="link" title="Connections & devices" onClick={() => go('connect')} />
          <Row icon="trash" title="Delete everything on this device" danger onClick={async () => { if (confirm('Delete your 2qo identity, chats and media from this device? This cannot be undone.')) { await DB.wipe(); location.reload(); } }} />
        </Section>
        <p class="center muted small" style={{ padding: '10px 0 30px' }}>
          2qo v0.1 · offline-first PWA · <a href="https://docs.postcode.gov.ng" target="_blank" rel="noopener noreferrer">Postcode API docs</a>
        </p>
      </div>
    </div>
  );
}

function pickContacts(title, current, onDone, list) {
  list = list || Object.values(getState().contacts).filter((c) => c.saved);
  function P() {
    const [sel, setSel] = useState(current);
    return (
      <div class="menu">
        <div class="menu-t">{title}</div>
        {list.map((c) => (
          <button class="menu-i" onClick={() => setSel((x) => (x.includes(c.id) ? x.filter((y) => y !== c.id) : [...x, c.id]))}>
            <span class={'check' + (sel.includes(c.id) ? ' on' : '')}>{sel.includes(c.id) && <Icon name="check" size={14} />}</span>
            <span>{c.alias || c.name}</span>
          </button>
        ))}
        {!list.length && <p class="muted pad">Save some contacts first.</p>}
        <button class="btn block" onClick={() => { onDone(sel); setState({ sheet: null }); }}>Done</button>
      </div>
    );
  }
  sheet(<P />);
}

export function Profile() {
  const me = useStore((s) => s.me);
  const [name, setName] = useState(me.name);
  const [about, setAbout] = useState(me.about || '');
  const [pc, setPc] = useState(formatPartial(me.postcode || ''));
  const p = pc ? parse(pc) : null;
  async function save() {
    await core.updateProfile({ name: name.trim() || me.name, about, postcode: p?.ok ? p.canonical : '' });
    toast('Profile updated');
  }
  return (
    <div class="screen">
      <Header title="Profile" />
      <div class="scroll pad">
        <div class="center" style={{ marginBottom: 16 }}>
          <label style={{ cursor: 'pointer', display: 'inline-block' }}>
            <Avatar id={me.id} name={me.name} src={me.avatar} size={120} />
            <input type="file" accept="image/*" hidden onChange={async (e) => e.target.files[0] && core.updateProfile({ avatar: await smallAvatar(e.target.files[0]) })} />
          </label>
          <div class="muted small">Tap photo to change</div>
        </div>
        <Field label="Name"><input class="inp" value={name} maxLength={40} onInput={(e) => setName(e.target.value)} /></Field>
        <Field label="About"><input class="inp" value={about} maxLength={140} onInput={(e) => setAbout(e.target.value)} /></Field>
        <Field label="Postcode" hint={p && !p.ok ? <span class="err">{p.error}</span> : p?.ok ? <span class="ok">✓ {p.display}</span> : 'Optional — used for “people near me”'}>
          <div style={{ display: 'flex', gap: 8 }}>
            <input class="inp mono" value={pc} onInput={(e) => setPc(formatPartial(e.target.value))} />
            <button class="btn ghost" onClick={async () => { try { const w = await whereAmI(); await core.updateProfile({ lat: w.lat, lng: w.lng }); if (w.postcode) setPc(formatPartial(w.postcode)); else toast(w.message || 'No postcode here'); } catch (e) { toast(e.message); } }}><Icon name="location" size={18} /></button>
          </div>
        </Field>
        <button class="btn block" disabled={p && !p.ok} onClick={save}>Save</button>
        <Section title="Your 2qo ID">
          <Row icon="key" title={me.id.match(/.{4}/g).join(' ')} sub="Derived from your encryption key" right={<button class="btn ghost" style={{ padding: '6px 10px' }} onClick={() => go('connect')}>QR</button>} />
        </Section>
      </div>
    </div>
  );
}
