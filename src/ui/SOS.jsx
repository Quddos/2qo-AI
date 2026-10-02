import { useEffect, useState } from 'preact/hooks';
import { useStore, go, toast } from '../lib/store.js';
import * as core from '../lib/core.js';
import { Header, Icon, Row, Section, Video, timeShort, useBlobUrl } from './kit.jsx';
import { runSOS, cancelSOS, closeSOS, sendNow, sosHistory, shareRecording } from '../lib/sos.js';
import { KINDS, fmtDistance, mapsLink } from '../lib/places.js';
import { fmtDuration } from '../lib/media.js';

export function SOSScreen() {
  const settings = useStore((s) => s.settings);
  const [service, setService] = useState('police');
  const [mode, setMode] = useState(settings.sosMode || 'video');
  const [hist, setHist] = useState([]);
  const sos = useStore((s) => s.sos);
  useEffect(() => void sosHistory().then(setHist), [sos?.done]);
  const ec = settings.emergencyContacts || [];
  return (
    <div class="screen">
      <Header title="SOS" sub="Record · locate · alert nearest help" />
      <div class="scroll">
        <div class="chips" style={{ justifyContent: 'center', flexWrap: 'wrap' }}>
          {['police', 'hospital', 'fire'].map((k) => (
            <button class={'chip' + (service === k ? ' on' : '')} onClick={() => setService(k)}>{KINDS[k].icon} {KINDS[k].label}</button>
          ))}
        </div>
        <div class="chips" style={{ justifyContent: 'center', flexWrap: 'wrap' }}>
          <button class={'chip' + (mode === 'video' ? ' on' : '')} onClick={() => setMode('video')}>🎥 Video</button>
          <button class={'chip' + (mode === 'audio' ? ' on' : '')} onClick={() => setMode('audio')}>🎙️ Audio only (discreet)</button>
        </div>
        <button class="sos-big" onClick={() => runSOS({ service, mode })} aria-label="Start SOS">SOS</button>
        <p class="center muted small" style={{ padding: '0 30px' }}>
          Starts recording immediately, finds your postcode & the nearest {KINDS[service].label.toLowerCase()}, then after a {settings.sosCountdown}s countdown sends the alert. Or just say: <b>“Hey 2qo, record my situation and send it to the nearest police station.”</b>
        </p>
        <div class="btns" style={{ justifyContent: 'center', margin: '12px 0' }}>
          <a class="btn red" href={'tel:' + settings.emergencyNumber}><Icon name="phone" size={18} /> Call {settings.emergencyNumber}</a>
          <button class="btn ghost" onClick={() => go('nearby')}>Nearby services</button>
        </div>
        <Section title="Who gets alerted">
          <Row icon="shield" title="Nearest station on 2qo" sub="Station accounts you’ve marked as trusted get the recording, encrypted" />
          <Row icon="users" title={`Emergency contacts (${ec.length})`} sub={ec.length ? ec.map((id) => core.displayName(id)).join(', ') : 'None yet — add trusted people'} onClick={() => go('settings', { section: 'sos' })} />
          <Row icon="chat" title={`SMS to ${settings.emergencyNumber} / station`} sub="Pre-filled with postcode & GPS — works with no data" />
        </Section>
        {hist.length > 0 && (
          <Section title="History">
            {hist.map((h) => (
              <HistRow h={h} key={h.id} />
            ))}
          </Section>
        )}
      </div>
    </div>
  );
}

function HistRow({ h }) {
  const [open, setOpen] = useState(false);
  const url = useBlobUrl(open ? h.mediaId : null);
  return (
    <Row icon="siren" title={`${KINDS[h.service]?.label || 'SOS'} · ${timeShort(h.ts)}`} sub={h.where?.postcode ? h.where.postcode.replace(/-/g, ' ') : h.station?.name || 'no location'} onClick={() => setOpen(!open)}>
      {open && (
        <div style={{ marginTop: 8 }}>
          <pre style={{ whiteSpace: 'pre-wrap', fontSize: '0.78rem', margin: '0 0 8px' }}>{h.text}</pre>
          {url && (h.mime?.startsWith('video') ? <video src={url} controls style={{ width: '100%', borderRadius: 12 }} /> : <audio src={url} controls />)}
        </div>
      )}
    </Row>
  );
}

const STEP_LABEL = { record: 'Recording evidence', locate: 'Location & postcode', station: 'Nearest help', send: 'Alert' };

export function SOSOverlay() {
  const sos = useStore((s) => s.sos);
  if (!sos) return null;
  return (
    <div class="sos-ov" role="alertdialog" aria-label="SOS in progress">
      <div class="preview">
        {sos.stream && sos.mode === 'video' && !sos.done ? <Video stream={sos.stream} muted /> : <div style={{ height: '100%', display: 'grid', placeItems: 'center', fontSize: 64 }}>{sos.done ? '✅' : '🎙️'}</div>}
        {!sos.done && sos.recorder && (
          <div class="recdot"><i /> REC {fmtDuration(sos.recSeconds)} / {fmtDuration(sos.seconds)}</div>
        )}
      </div>
      <div class="sos-steps">
        <h2 style={{ margin: '4px 0' }}>{sos.done ? 'Alert sent' : `${KINDS[sos.service].icon} SOS — ${KINDS[sos.service].label}`}</h2>
        {sos.counting > 0 && (
          <div class="countdown">
            {sos.counting}
            <div style={{ fontSize: '0.9rem', color: '#fff', fontWeight: 600 }}>sending in…</div>
          </div>
        )}
        {['record', 'locate', 'station', 'send'].map((k) => {
          const st = sos.steps[k];
          return (
            <div class={'sos-step s-' + (st?.state || 'wait')}>
              <div class="st">{st?.state === 'ok' ? '✓' : st?.state === 'error' || st?.state === 'warn' ? '!' : st?.state === 'active' ? '•' : ''}</div>
              <div>
                <b>{STEP_LABEL[k]}</b>
                <small>{st?.detail || 'waiting'}</small>
              </div>
            </div>
          );
        })}
        {sos.where && (
          <a class="btn ghost" style={{ color: '#fff', background: '#fff1' }} href={mapsLink(sos.where.lat, sos.where.lng)} target="_blank" rel="noopener noreferrer">
            <Icon name="location" size={18} /> Open my location on map
          </a>
        )}
        {sos.alternatives?.length > 0 && <small style={{ opacity: 0.8 }}>Also near: {sos.alternatives.map((a) => `${a.name} (${fmtDistance(a.distance)})`).join(', ')}</small>}
      </div>
      <div class="sos-actions">
        {sos.done ? (
          <>
            <a class="btn sun" href={sos.smsHref}><Icon name="chat" size={18} /> Send SMS</a>
            <a class="btn red" href={sos.telHref}><Icon name="phone" size={18} /> Call now</a>
            <button class="btn ghost" style={{ color: '#fff', background: '#fff2' }} onClick={shareRecording}><Icon name="upload" size={18} /> Share video</button>
            <button class="btn" onClick={closeSOS}>Done</button>
          </>
        ) : (
          <>
            <button class="btn ghost" style={{ color: '#fff', background: '#fff2' }} onClick={cancelSOS}>Cancel</button>
            <button class="btn red" onClick={sendNow}>Send now</button>
          </>
        )}
      </div>
    </div>
  );
}
