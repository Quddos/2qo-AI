import { useEffect, useState } from 'preact/hooks';
import { useStore, go, sheet, getState, setState } from '../lib/store.js';
import * as core from '../lib/core.js';
import { put } from '../lib/db.js';
import { Avatar, Icon, IconBtn, Empty, Menu, Row, Section, timeShort, Video } from './kit.jsx';
import { NetPill } from './Chats.jsx';
import { startCall, acceptCall, reject, end, toggleMute, toggleCam, flipCam } from '../lib/calls.js';
import { fmtDuration } from '../lib/media.js';

export function Calls() {
  const calls = useStore((s) => s.calls);
  const contacts = useStore((s) => s.contacts);
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
      </header>
      <div class="scroll with-dock">
        <p class="muted small" style={{ padding: '0 20px' }}>Calls go device-to-device (WebRTC). On the same Wi-Fi / hotspot they need no internet at all.</p>
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

export function CallScreen() {
  const call = useStore((s) => s.call);
  const contacts = useStore((s) => s.contacts);
  const [, tick] = useState(0);
  useEffect(() => {
    if (!call?.connectedAt) return;
    const t = setInterval(() => tick((x) => x + 1), 1000);
    return () => clearInterval(t);
  }, [call?.connectedAt]);
  if (!call) return null;
  const c = contacts[call.peer];
  const status = call.state === 'connected' ? fmtDuration((Date.now() - call.connectedAt) / 1000) : call.state === 'ringing' ? `Incoming ${call.video ? 'video' : 'voice'} call` : call.state === 'calling' ? call.note || 'Calling…' : 'Connecting…';
  const showVideo = call.video && call.remote;
  return (
    <div class="callscr">
      {showVideo && <Video stream={call.remote} class="remote" />}
      {!showVideo && call.remote && <Video stream={call.remote} class="hide" />}
      {call.video && call.local && <Video stream={call.local} muted mirror class="localv" />}
      <div class="who" style={showVideo ? { marginTop: 'max(16px, env(safe-area-inset-top))', textShadow: '0 1px 6px #000' } : null}>
        {!showVideo && <Avatar id={call.peer} name={core.displayName(call.peer)} src={c?.avatar} size={120} />}
        <h2>{core.displayName(call.peer)}</h2>
        <div>{status}</div>
        <small style={{ opacity: 0.7 }}>🔐 End-to-end encrypted</small>
      </div>
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
            <button class="end" onClick={() => end()} aria-label="End call"><Icon name="hangup" size={26} /></button>
          </>
        )}
      </div>
    </div>
  );
}
