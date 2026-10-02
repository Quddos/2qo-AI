import { useEffect, useRef, useState } from 'preact/hooks';
import QRCode from 'qrcode';
import { useStore, go, toast, getState } from '../lib/store.js';
import * as core from '../lib/core.js';
import { Header, Icon, Row, Section, Field, Toggle } from './kit.jsx';
import { defaultHubUrl } from '../lib/net/hub.js';

export function QR({ text, size = 260 }) {
  const [url, set] = useState(null);
  const [err, setErr] = useState(null);
  useEffect(() => {
    QRCode.toDataURL(text, { errorCorrectionLevel: 'L', margin: 1, width: size })
      .then(set)
      .catch((e) => setErr(e.message));
  }, [text]);
  if (err) return <div class="muted small">Too large for a QR code — use Copy instead.</div>;
  return <div class="qr">{url && <img src={url} alt="QR code" />}</div>;
}

function copy(text) {
  navigator.clipboard?.writeText(text).then(() => toast('Copied'), () => toast('Copy failed'));
}

/** Handles anything scanned or pasted: contact cards, channel invites, P2P link codes. */
export async function handleCode(raw, setAnswer) {
  raw = String(raw || '').trim();
  if (!raw) return;
  try {
    if (raw.startsWith('{')) {
      const d = JSON.parse(raw);
      if (d.t === '2qo-contact') {
        const c = await core.addContactFromCard(d);
        await core.openDirect(c.id);
        toast(`${c.name} added`);
        return go('chat', { id: c.id });
      }
      if (d.t === '2qo-channel') {
        await core.followChannel(d);
        toast(`Following ${d.name}`);
        return go('chat', { id: d.id });
      }
    }
    if (/^[ZJ]/.test(raw)) {
      try {
        const r = await core.net.p2p.acceptInvite(raw);
        setAnswer?.(r);
        toast(`Invite from ${r.from || 'a phone'} — show them your reply code`);
        return;
      } catch (e) {
        if (!/not a 2qo invite/.test(e.message)) throw e;
        await core.net.p2p.completeInvite(raw);
        toast('Linked! Waiting for connection…');
        return;
      }
    }
    toast('Unrecognised code');
  } catch (e) {
    toast(e.message);
  }
}

function Scanner({ onResult }) {
  const vref = useRef();
  const [err, setErr] = useState(null);
  useEffect(() => {
    let stream;
    let stop = false;
    (async () => {
      if (!('BarcodeDetector' in globalThis)) return setErr('Camera QR scanning isn’t supported in this browser — paste the code below.');
      try {
        stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } });
        vref.current.srcObject = stream;
        await vref.current.play();
        const det = new BarcodeDetector({ formats: ['qr_code'] });
        while (!stop) {
          const codes = await det.detect(vref.current).catch(() => []);
          if (codes[0]?.rawValue) {
            stop = true;
            onResult(codes[0].rawValue);
            break;
          }
          await new Promise((r) => setTimeout(r, 300));
        }
      } catch (e) {
        setErr(e.message);
      }
    })();
    return () => {
      stop = true;
      stream?.getTracks().forEach((t) => t.stop());
    };
  }, []);
  return err ? <p class="muted small">{err}</p> : <video ref={vref} playsInline muted style={{ width: '100%', borderRadius: 18, background: '#000', maxHeight: 320, objectFit: 'cover' }} />;
}

export function Connect({ tab: initialTab = 'me' }) {
  const me = useStore((s) => s.me);
  const net = useStore((s) => s.net);
  const settings = useStore((s) => s.settings);
  const [tab, setTab] = useState(initialTab);
  const [invite, setInvite] = useState(null);
  const [answer, setAnswer] = useState(null);
  const [paste, setPaste] = useState('');
  const [hubUrl, setHubUrl] = useState(settings.hubUrl || '');
  const [outbox, setOutbox] = useState(0);
  const card = JSON.stringify(core.contactCard());
  useEffect(() => {
    core.outboxCount().then(setOutbox);
    const t = setInterval(() => core.outboxCount().then(setOutbox), 3000);
    return () => clearInterval(t);
  }, []);

  return (
    <div class="screen">
      <Header title="Connect" sub="Share, scan, link phones & hubs" />
      <div class="chips">
        {[['me', 'My code'], ['scan', 'Scan / paste'], ['link', 'Link phones'], ['hub', 'Hub'], ['status', 'Status']].map(([k, l]) => (
          <button class={'chip' + (tab === k ? ' on' : '')} onClick={() => setTab(k)}>{l}</button>
        ))}
      </div>
      <div class="scroll pad">
        {tab === 'me' && (
          <div class="center stack">
            <div>
              <QR text={card} />
            </div>
            <h3 style={{ margin: 0 }}>{me.name}</h3>
            <div class="muted small">2qo ID {me.id.slice(0, 4)} {me.id.slice(4, 8)} {me.id.slice(8, 12)}</div>
            <p class="muted small">People scan this to add you. No phone number is shared.</p>
            <div class="btns" style={{ justifyContent: 'center' }}>
              <button class="btn ghost" onClick={() => copy(card)}><Icon name="copy" size={18} /> Copy card</button>
              {navigator.share && <button class="btn ghost" onClick={() => navigator.share({ title: 'My 2qo card', text: card })}><Icon name="upload" size={18} /> Share</button>}
            </div>
          </div>
        )}
        {tab === 'scan' && (
          <div class="stack">
            <Scanner onResult={(r) => handleCode(r, (a) => (setAnswer(a), setTab('link')))} />
            <Field label="…or paste a code">
              <textarea class="inp" value={paste} onInput={(e) => setPaste(e.target.value)} placeholder="Contact card, channel invite or phone-link code" />
            </Field>
            <button class="btn" disabled={!paste.trim()} onClick={() => handleCode(paste, (a) => (setAnswer(a), setTab('link')))}>Use code</button>
          </div>
        )}
        {tab === 'link' && (
          <div class="stack">
            <p class="muted small">
              Link two phones directly — no internet, no SIM data. Both phones just need to be on the same Wi-Fi or one phone’s hotspot. Linked phones also relay messages for each other (mesh).
            </p>
            {answer ? (
              <div class="center stack">
                <b>Step 2 · Show this reply to {answer.from || 'the other phone'}</b>
                <div><QR text={answer.code} /></div>
                <button class="btn ghost" onClick={() => copy(answer.code)}>Copy reply code</button>
                <button class="btn" onClick={() => setAnswer(null)}>Done</button>
              </div>
            ) : invite ? (
              <div class="center stack">
                <b>Step 1 · Let the other phone scan this</b>
                <div><QR text={invite.code} /></div>
                <button class="btn ghost" onClick={() => copy(invite.code)}>Copy invite code</button>
                <b>Step 3 · Scan or paste their reply</b>
                <button class="btn" onClick={() => setTab('scan')}><Icon name="qr" size={18} /> Scan reply</button>
                <textarea class="inp" placeholder="…or paste reply code" value={paste} onInput={(e) => setPaste(e.target.value)} />
                <button class="btn" disabled={!paste} onClick={() => handleCode(paste).then(() => (setPaste(''), setInvite(null)))}>Connect</button>
              </div>
            ) : (
              <>
                <button class="btn block" onClick={async () => setInvite(await core.net.p2p.createInvite())}><Icon name="link" size={18} /> Create link invite</button>
                <button class="btn ghost block" onClick={() => setTab('scan')}><Icon name="qr" size={18} /> I have an invite — scan it</button>
              </>
            )}
            <Section title={`Linked phones (${net.peers.length})`}>
              {net.peers.map((p) => <Row icon="link" title={p.name || 'Phone'} sub="Direct link · relaying" />)}
              {!net.peers.length && <Row title="None yet" />}
            </Section>
          </div>
        )}
        {tab === 'hub' && (
          <div class="stack">
            <p class="muted small">
              A <b>2qo Hub</b> is a tiny server anyone can run on a laptop, Raspberry Pi or Android (Termux) — on a local hotspot with no internet. It stores messages for offline friends, lists people by postcode, and serves the app itself. Run <code>npm run hub</code> and open its address on each phone.
            </p>
            <Row icon="hub" title={'Status: ' + net.hub} sub={core.net.hub?.url || 'not configured'} />
            <Row icon="wifi" title="Auto-connect to the hub that served this app" right={<Toggle checked={settings.autoHub} onChange={(v) => core.updateSettings({ autoHub: v })} />} />
            <Field label="Hub address" hint={`Default: ${defaultHubUrl()}`}>
              <input class="inp" value={hubUrl} placeholder="ws://192.168.43.1:8787/hub" onInput={(e) => setHubUrl(e.target.value)} />
            </Field>
            <button class="btn" onClick={() => core.updateSettings({ hubUrl: hubUrl.trim() }).then(() => toast('Connecting…'))}>Save & connect</button>
          </div>
        )}
        {tab === 'status' && (
          <Section>
            <Row icon={net.online ? 'wifi' : 'wifioff'} title={net.online ? 'Internet: online' : 'Internet: offline'} />
            <Row icon="hub" title={'Hub: ' + net.hub} />
            <Row icon="link" title={`Direct links: ${net.peers.length}`} />
            <Row icon="users" title="Same-device tabs: on" sub="Open ?as=name in another tab to test multi-user" />
            <Row icon="clock" title={`Waiting to deliver: ${outbox}`} sub="Delivered automatically when the recipient is reachable" right={<button class="btn ghost" style={{ padding: '6px 10px' }} onClick={() => core.flushOutbox()}>Retry</button>} />
          </Section>
        )}
      </div>
    </div>
  );
}
