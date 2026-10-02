import { useEffect, useRef, useState } from 'preact/hooks';
import { useStore, go, sheet, getState, setState } from '../lib/store.js';
import * as core from '../lib/core.js';
import { put } from '../lib/db.js';
import { Avatar, Icon, IconBtn, Empty, Menu, Row, Section, timeShort, Video } from './kit.jsx';
import { NetPill } from './Chats.jsx';
import { startCall, acceptCall, reject, end, toggleMute, toggleCam, flipCam, shareMusic, toggleMusic, seekMusic, nextTrack, musicVolume, stopMusic, playTrack } from '../lib/calls.js';
import { fmtDuration } from '../lib/media.js';

export function Calls() {
  const calls = useStore((s) => s.calls);
  const contacts = useStore((s) => s.contacts);
  useStore((s) => s.presence);
  useStore((s) => s.net);
  const reachable = Object.values(contacts).filter((c) => !c.blocked && !c.isOrg && core.reachability(c.id).ok);
  useEffect(() => {
    const unseen = getState().calls.filter((c) => c.outcome === 'missed' && !c.seen);
    if (!unseen.length) return;
    for (const c of unseen) put('calls', { ...c, seen: true });
    setState((s) => ({ calls: s.calls.map((c) => ({ ...c, seen: true })) }));
  }, []);
  function newCall() {
    const list = Object.values(contacts).filter((c) => c.saved && !c.blocked);
    sheet(
      <Menu
        title="Start a call"
        items={list.length ? list.flatMap((c) => [{ icon: 'phone', label: c.alias || c.name, hint: 'voice', onClick: () => startCall(c.id, false) }, { icon: 'video', label: c.alias || c.name, hint: 'video', onClick: () => startCall(c.id, true) }]) : [{ icon: 'qr', label: 'Add contacts first', onClick: () => go('connect') }]}
      />,
    );
  }
  return (
    <div class="screen">
      <header class="hdr">
        <div class="brand"><b style={{ fontSize: '1.35rem' }}>Calls</b></div>
        <div class="spacer" />
        <NetPill />
        <IconBtn name="link" label="Link phones (no data needed)" onClick={() => go('connect', { tab: 'link' })} />
      </header>
      <div class="scroll with-dock">
        <p class="muted small" style={{ padding: '0 20px' }}>Calls go phone-to-phone. On the same Wi-Fi or hotspot they need <b>no data and no internet</b>. During a call, tap 🎵 to play a song from your phone for both of you.</p>
        <Section title="Reachable now">
          {reachable.map((c) => (
            <Row
              avatar={<Avatar id={c.id} name={c.alias || c.name} src={c.avatar} size={44} online />}
              title={c.alias || c.name}
              sub={'via ' + core.reachability(c.id).via}
              right={
                <div style={{ display: 'flex' }}>
                  <IconBtn name="phone" label="Voice call" onClick={() => startCall(c.id, false)} />
                  <IconBtn name="video" label="Video call" onClick={() => startCall(c.id, true)} />
                </div>
              }
            />
          ))}
          {!reachable.length && <Row icon="link" title="No one linked right now" sub="No data? Link phones on the same Wi-Fi or hotspot with a QR code" onClick={() => go('connect', { tab: 'link' })} />}
        </Section>
        {calls.length ? (
          <Section title="Recent">
            {calls.map((c) => {
              const red = c.outcome === 'missed' || c.outcome === 'declined';
              return (
                <Row
                  avatar={<Avatar id={c.peer} name={core.displayName(c.peer)} src={contacts[c.peer]?.avatar} size={44} />}
                  title={<span style={{ color: red ? 'var(--red)' : undefined }}>{core.displayName(c.peer)}</span>}
                  sub={
                    <>
                      <Icon name={c.dir === 'in' ? 'download' : 'upload'} size={14} />
                      {c.outcome} · {timeShort(c.ts)}
                      {c.duration ? ' · ' + fmtDuration(c.duration) : ''}
                    </>
                  }
                  right={<IconBtn name={c.video ? 'video' : 'phone'} label="Call back" onClick={(e) => (e.stopPropagation(), startCall(c.peer, c.video))} />}
                  onClick={() => go('chatinfo', { id: c.peer })}
                />
              );
            })}
          </Section>
        ) : (
          <Empty icon="calls" title="No calls yet">Voice and video calls with your 2qo contacts appear here.</Empty>
        )}
      </div>
      <button class="fab" onClick={newCall} aria-label="New call">
        <Icon name="phone" />
      </button>
    </div>
  );
}

function MusicPanel({ call, pick }) {
  const m = call.music;
  const r = call.remoteMusic;
  if (m)
    return (
      <div class="musicbar">
        <div class="mb-top">
          <div class="eq" data-on={m.playing ? '1' : '0'}><i /><i /><i /></div>
          <div class="mb-t">
            <b>{m.title}</b>
            <small>Playing for both of you · {m.idx + 1}/{m.count}</small>
          </div>
          <button class="mb-x" onClick={() => stopMusic()} aria-label="Stop sharing music"><Icon name="close" size={18} /></button>
        </div>
        <input class="mb-seek" type="range" min="0" max={Math.max(1, Math.floor(m.dur))} value={Math.floor(m.pos)} onInput={(e) => seekMusic(+e.target.value)} aria-label="Seek" />
        <div class="mb-ctrl">
          <small>{fmtDuration(m.pos)}</small>
          <button onClick={() => nextTrack(-1)} disabled={m.idx === 0} aria-label="Previous">⏮</button>
          <button class="mb-play" onClick={toggleMusic} aria-label={m.playing ? 'Pause' : 'Play'}><Icon name={m.playing ? 'pause' : 'play'} fill size={20} /></button>
          <button onClick={() => nextTrack(1)} disabled={m.idx >= m.count - 1} aria-label="Next">⏭</button>
          <small>{fmtDuration(m.dur)}</small>
        </div>
        <div class="mb-ctrl">
          <Icon name="speaker" size={16} />
          <input type="range" min="0" max="1" step="0.05" value={m.volume} onInput={(e) => musicVolume(+e.target.value)} aria-label="Music volume" style={{ flex: 1 }} />
          <button class="mb-add" onClick={pick}><Icon name="plus" size={16} /> Add songs</button>
        </div>
        {m.count > 1 && (
          <div class="mb-queue">
            {m.queue.map((t, i) => (
              <button class={i === m.idx ? 'on' : ''} onClick={() => playTrack(i)}>{i + 1}. {t}</button>
            ))}
          </div>
        )}
      </div>
    );
  if (r) {
    const pos = r.playing ? r.pos + (Date.now() - r.at) / 1000 : r.pos;
    return (
      <div class="musicbar listen">
        <div class="mb-top">
          <div class="eq" data-on={r.playing ? '1' : '0'}><i /><i /><i /></div>
          <div class="mb-t">
            <b>{r.title}</b>
            <small>🎵 From {core.displayName(call.peer).split(' ')[0]}’s phone{r.count > 1 ? ` · ${r.idx + 1}/${r.count}` : ''}</small>
          </div>
        </div>
        <div class="mb-prog"><b style={{ width: r.dur ? Math.min(100, (pos / r.dur) * 100) + '%' : 0 }} /></div>
      </div>
    );
  }
  return null;
}

export function CallScreen() {
  const call = useStore((s) => s.call);
  const contacts = useStore((s) => s.contacts);
  const fileRef = useRef();
  const [, tick] = useState(0);
  useEffect(() => {
    if (!call?.connectedAt) return;
    const t = setInterval(() => tick((x) => x + 1), 1000);
    return () => clearInterval(t);
  }, [call?.connectedAt]);
  if (!call) return null;
  const c = contacts[call.peer];
  const status = call.state === 'connected' ? (call.weak ? 'Reconnecting…' : fmtDuration((Date.now() - call.connectedAt) / 1000)) : call.state === 'ringing' ? `Incoming ${call.video ? 'video' : 'voice'} call` : call.state === 'calling' ? call.note || 'Calling…' : 'Connecting…';
  const showVideo = call.video && call.remote;
  const pick = () => fileRef.current?.click();
  return (
    <div class="callscr">
      {showVideo && <Video stream={call.remote} class="remote" />}
      {!showVideo && call.remote && <Video stream={call.remote} class="hide" />}
      {call.video && call.local && <Video stream={call.local} muted mirror class="localv" />}
      <div class="who" style={showVideo ? { marginTop: 'max(16px, env(safe-area-inset-top))', textShadow: '0 1px 6px #000' } : null}>
        {!showVideo && <Avatar id={call.peer} name={core.displayName(call.peer)} src={c?.avatar} size={120} />}
        <h2>{core.displayName(call.peer)}</h2>
        <div>{status}</div>
        <small style={{ opacity: 0.7 }}>🔐 End-to-end encrypted{call.via ? ` · via ${call.via}` : ''}{!navigator.onLine ? ' · no internet needed' : ''}</small>
        {call.unreachable && call.state === 'calling' && (
          <div class="call-tip">
            Not linked to {core.displayName(call.peer).split(' ')[0]} right now. With no data, link your phones on the same Wi-Fi or hotspot first.
            <button class="btn sun" onClick={() => (end(), go('connect', { tab: 'link' }))}>Link phones</button>
          </div>
        )}
      </div>
      <input ref={fileRef} type="file" accept="audio/*,.mp3,.m4a,.aac,.wav,.ogg,.opus,.flac" multiple hidden onChange={(e) => (shareMusic(e.target.files), (e.target.value = ''))} />
      {call.state === 'connected' && <MusicPanel call={call} pick={pick} />}
      <div class="ctrls">
        {call.state === 'ringing' ? (
          <>
            <button class="end" onClick={reject} aria-label="Decline"><Icon name="hangup" size={26} /></button>
            <button class="acc" onClick={acceptCall} aria-label="Accept"><Icon name={call.video ? 'video' : 'phone'} size={26} /></button>
          </>
        ) : (
          <>
            <button class={call.muted ? 'on' : ''} onClick={toggleMute} aria-label="Mute"><Icon name={call.muted ? 'micoff' : 'mic'} /></button>
            {call.video && <button class={call.camOff ? 'on' : ''} onClick={toggleCam} aria-label="Camera"><Icon name={call.camOff ? 'videooff' : 'video'} /></button>}
            {call.video && <button onClick={flipCam} aria-label="Flip camera"><Icon name="flip" /></button>}
            {call.state === 'connected' && <button class={call.music ? 'on' : ''} onClick={pick} aria-label="Play my song" title="Play a song from your phone for both of you"><Icon name="music" /></button>}
            <button class="end" onClick={() => end()} aria-label="End call"><Icon name="hangup" size={26} /></button>
          </>
        )}
      </div>
    </div>
  );
}
