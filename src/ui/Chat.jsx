import { useEffect, useLayoutEffect, useRef, useState } from 'preact/hooks';
import { useStore, go, sheet, toast, getState, setState } from '../lib/store.js';
import * as core from '../lib/core.js';
import { Avatar, Header, Icon, IconBtn, Menu, clock, dayLabel, lastSeen, useBlobUrl, PostcodeChip, Field } from './kit.jsx';
import { chatAvatar } from './Chats.jsx';
import { startCall } from '../lib/calls.js';
import { compressImage, startRecording, fmtDuration, fmtSize, fileToDataURL } from '../lib/media.js';
import { locate, reverse } from '../lib/postcode/client.js';
import { mapsLink } from '../lib/places.js';
import { hashPin } from '../lib/crypto.js';
import { display as pcDisplay } from '../lib/postcode/format.js';

const REACTIONS = ['❤️', '😂', '👍', '🙏', '😮', '😢', '🔥'];
export const EMOJI = '😀😂🤣😊😍🥰😘😎🤩🥳🤔🙄😴😭😡🤯🥺😇🙏👍👎👏🙌💪🤝👀🔥✨🎉❤️💔💯✅❌⚠️🚨📍🏠🚗🛵🚌⛽💰📞📷🎶⚽🍲🍚🌶️🥘🍺☕🌧️☀️🌙🇳🇬'.match(/(\p{Extended_Pictographic}|\p{Regional_Indicator}{2})️?/gu);

function linkify(text) {
  const parts = String(text).split(/(https?:\/\/[^\s]+|\b[A-Z]{2}[\s-]?\d{2}[\s-]?[A-Z0-9]{3}[\s-]?[A-Z]{2}[\s-]?\d{2}\b)/g);
  return parts.map((p, i) => (i % 2 ? (p.startsWith('http') ? <a href={p} target="_blank" rel="noopener noreferrer">{p}</a> : <PostcodeChip code={p} onClick={(e) => (e.stopPropagation(), go('postcode', { code: p }))} />) : p));
}

// --------------------------------------------------------------- bubbles ----
function AudioPlayer({ blobId, duration }) {
  const url = useBlobUrl(blobId);
  const ref = useRef();
  const [playing, setPlaying] = useState(false);
  const [pos, setPos] = useState(0);
  const bars = 28;
  return (
    <div class="aud">
      <button onClick={(e) => (e.stopPropagation(), playing ? ref.current.pause() : ref.current.play())} aria-label={playing ? 'Pause' : 'Play'}>
        <Icon name={playing ? 'pause' : 'play'} size={16} fill />
      </button>
      <div class="bar">
        {Array.from({ length: bars }, (_, i) => (
          <i class={i / bars < pos ? 'on' : ''} style={{ height: 6 + ((i * 37) % 17) + 'px' }} />
        ))}
      </div>
      <small>{fmtDuration(playing ? (ref.current?.currentTime || 0) : duration)}</small>
      {url && <audio ref={ref} src={url} preload="metadata" onPlay={() => setPlaying(true)} onPause={() => setPlaying(false)} onEnded={() => (setPlaying(false), setPos(0))} onTimeUpdate={(e) => setPos(e.target.currentTime / (e.target.duration || duration || 1))} />}
    </div>
  );
}

function Media({ m }) {
  const url = useBlobUrl(m.media?.blobId);
  if (!m.media) return null;
  if (!url) return <div class="media" style={{ height: 160, display: 'grid', placeItems: 'center' }}>…</div>;
  if (m.kind === 'image') return <div class="media"><img src={url} alt="Photo" onClick={(e) => (e.stopPropagation(), lightbox(url, 'image'))} loading="lazy" /></div>;
  if (m.kind === 'video' || (m.kind === 'sos' && m.media.mime?.startsWith('video')))
    return <div class="media"><video src={url} controls playsInline preload="metadata" /></div>;
  if (m.kind === 'audio' || (m.kind === 'sos' && m.media.mime?.startsWith('audio'))) return <AudioPlayer blobId={m.media.blobId} duration={m.media.duration} />;
  return (
    <a class="file" href={url} download={m.media.name || 'file'} onClick={(e) => e.stopPropagation()}>
      <Icon name="file" size={28} />
      <div style={{ minWidth: 0 }}>
        <div style={{ fontWeight: 650, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{m.media.name || 'Document'}</div>
        <small style={{ opacity: 0.75 }}>{fmtSize(m.media.size || 0)} · {(m.media.mime || '').split('/')[1] || 'file'}</small>
      </div>
      <Icon name="download" size={18} />
    </a>
  );
}

function lightbox(url, kind) {
  setState({
    sheet: (
      <div class="lightbox" onClick={() => setState({ sheet: null })}>
        {kind === 'image' ? <img src={url} alt="" /> : <video src={url} controls autoPlay />}
      </div>
    ),
  });
}

function Poll({ m, chatId }) {
  const me = useStore((s) => s.me.id);
  const total = new Set(m.poll.options.flatMap((o) => o.votes)).size;
  const mine = m.poll.options.map((o, i) => (o.votes.includes(me) ? i : -1)).filter((i) => i >= 0);
  function vote(i) {
    let next = m.poll.multi ? (mine.includes(i) ? mine.filter((x) => x !== i) : [...mine, i]) : mine.includes(i) ? [] : [i];
    core.votePoll(chatId, m.id, next);
  }
  return (
    <div class="poll">
      <h5>📊 {m.poll.question}</h5>
      {m.poll.options.map((o, i) => (
        <button class="popt" onClick={(e) => (e.stopPropagation(), vote(i))}>
          <div class="fill" style={{ width: total ? (o.votes.length / total) * 100 + '%' : 0 }} />
          <span>
            <span>{mine.includes(i) ? '✅ ' : ''}{o.text}</span>
            <b>{o.votes.length}</b>
          </span>
        </button>
      ))}
      <small style={{ opacity: 0.75 }}>{total} vote{total === 1 ? '' : 's'} · {m.poll.multi ? 'multiple answers' : 'one answer'}</small>
    </div>
  );
}

export function Bubble({ m, chat, prev, mine, onAction, selected, flash }) {
  const contacts = useStore((s) => s.contacts);
  if (m.kind === 'system') return <div class="sys">{m.text}</div>;
  const first = !prev || prev.from !== m.from || prev.kind === 'system' || m.ts - prev.ts > 5 * 60000;
  const showName = !mine && first && ['group', 'community'].includes(chat.type);
  const replied = m.replyTo && (getState().messages[chat.id] || []).find((x) => x.id === m.replyTo);
  const reactions = Object.values(m.reactions || {});
  const counts = reactions.reduce((a, e) => ((a[e] = (a[e] || 0) + 1), a), {});
  let pressTimer;
  return (
    <div
      id={'m-' + m.id}
      class={'msg ' + (mine ? 'me' : 'them') + (first ? ' first' : ' cont') + (selected ? ' sel' : '') + (flash ? ' flash' : '') + (m.from === 'ai' ? ' ai-msg' : '')}
      onContextMenu={(e) => (e.preventDefault(), onAction(m))}
      onTouchStart={() => (pressTimer = setTimeout(() => onAction(m), 450))}
      onTouchEnd={() => clearTimeout(pressTimer)}
      onTouchMove={() => clearTimeout(pressTimer)}
      onDblClick={() => core.reactTo(chat.id, m.id, '❤️')}
    >
      <div class={'bub' + (m.kind === 'sos' ? ' sosmsg' : '')}>
        {showName && <div class="who" style={{ color: `hsl(${(m.from.charCodeAt(0) * 47) % 360} 65% 50%)` }}>{core.displayName(m.from)}</div>}
        {m.forwarded && <div class="fwd"><Icon name="forward" size={13} /> Forwarded</div>}
        {replied && (
          <div class="quote" onClick={() => document.getElementById('m-' + replied.id)?.scrollIntoView({ behavior: 'smooth', block: 'center' })}>
            <b>{core.displayName(replied.from)}</b>
            {core.preview(replied).slice(0, 90)}
          </div>
        )}
        {m.deleted ? (
          <span class="del">🚫 {mine ? 'You deleted this message' : 'This message was deleted'}</span>
        ) : (
          <>
            {m.kind === 'sos' && <div class="sos-h"><Icon name="siren" size={18} /> SOS ALERT</div>}
            {m.inlineImage && <div class="media"><img src={m.inlineImage} alt="" /></div>}
            <Media m={m} />
            {m.kind === 'poll' && <Poll m={m} chatId={chat.id} />}
            {m.kind === 'location' && m.location && (
              <a class="file" href={mapsLink(m.location.lat, m.location.lng)} target="_blank" rel="noopener noreferrer" onClick={(e) => e.stopPropagation()}>
                <Icon name="location" size={28} />
                <div>
                  <div style={{ fontWeight: 650 }}>{m.location.live ? 'Live location' : 'Location'}</div>
                  {m.location.postcode && <PostcodeChip code={m.location.postcode} />}
                  <small style={{ display: 'block', opacity: 0.75 }}>{m.location.lat.toFixed(5)}, {m.location.lng.toFixed(5)}</small>
                </div>
              </a>
            )}
            {m.kind === 'contact' && m.contact && (
              <div class="file">
                <Avatar id={m.contact.id} name={m.contact.name} size={38} />
                <div style={{ flex: 1 }}>
                  <div style={{ fontWeight: 650 }}>{m.contact.name}</div>
                  {m.contact.postcode && <PostcodeChip code={m.contact.postcode} />}
                </div>
                {m.contact.id !== getState().me.id && (
                  <button class="btn ghost" style={{ padding: '6px 10px' }} onClick={async (e) => { e.stopPropagation(); try { await core.addContactFromCard(m.contact); toast('Contact saved'); } catch (x) { toast(x.message); } }}>
                    {contacts[m.contact.id]?.saved ? 'Saved' : 'Add'}
                  </button>
                )}
              </div>
            )}
            {m.places && (
              <div class="place-list">
                {m.places.map((p) => (
                  <a href={mapsLink(p.lat, p.lng)} target="_blank" rel="noopener noreferrer">
                    <span>{p.name}{p.phone ? ' · ' + p.phone : ''}</span>
                    <b>{p.distance < 1000 ? Math.round(p.distance) + ' m' : (p.distance / 1000).toFixed(1) + ' km'}</b>
                  </a>
                ))}
              </div>
            )}
            {m.text && <span class="txt">{linkify(m.text)}</span>}
            {m.link && <div><button class="btn ghost" style={{ marginTop: 6, padding: '6px 10px' }} onClick={() => go('chat', { id: m.link })}>Open chat</button></div>}
          </>
        )}
        <span class="meta">
          {m.starred && <Icon name="star" size={11} fill />}
          {m.edited && !m.deleted && <span>edited</span>}
          {m.expiresAt && <Icon name="timer" size={11} />}
          {clock(m.ts)}
          {mine && chat.type !== 'ai' && chat.type !== 'self' && !m.deleted && <MsgTicks status={m.status} />}
        </span>
      </div>
      {reactions.length > 0 && (
        <div class="reacts" onClick={() => showReactions(m)}>
          {Object.entries(counts).map(([e, n]) => (
            <span>{e}{n > 1 ? n : ''}</span>
          ))}
        </div>
      )}
    </div>
  );
}

function MsgTicks({ status }) {
  if (status === 'pending') return <Icon name="clock" size={12} />;
  if (status === 'sent') return <Icon name="check" size={14} />;
  if (status === 'delivered') return <Icon name="check2" size={15} />;
  if (status === 'read') return <span class="read"><Icon name="check2" size={15} stroke={2.6} /></span>;
  return null;
}

function showReactions(m) {
  sheet(
    <Menu
      title="Reactions"
      items={Object.entries(m.reactions || {}).map(([uid, e]) => ({ label: `${e}  ${core.displayName(uid)}`, onClick: () => {} }))}
    />,
  );
}

// -------------------------------------------------------------- lock gate --
function LockGate({ chat }) {
  const [pin, setPin] = useState('');
  const [err, setErr] = useState('');
  async function check() {
    const saved = getState().settings.pin;
    if (!saved) return setState((s) => ({ unlocked: { ...s.unlocked, [chat.id]: true } }));
    const h = await hashPin(pin, saved.salt);
    if (h.hash === saved.hash) setState((s) => ({ unlocked: { ...s.unlocked, [chat.id]: true } }));
    else (setErr('Wrong PIN'), setPin(''));
  }
  return (
    <div class="screen">
      <Header title={chat.name} />
      <div class="empty">
        <div class="empty-ic"><Icon name="lock" size={34} /></div>
        <h3>This chat is locked</h3>
        <input class="inp mono center" type="password" inputMode="numeric" maxLength={8} value={pin} onInput={(e) => setPin(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && check()} placeholder="Enter PIN" style={{ maxWidth: 200 }} autoFocus />
        {err && <div class="err">{err}</div>}
        <button class="btn" onClick={check}>Unlock</button>
      </div>
    </div>
  );
}

// ------------------------------------------------------------------- chat --
export function Chat({ id, focus }) {
  const chat = useStore((s) => s.chats[id]);
  const msgs = useStore((s) => s.messages[id]);
  const me = useStore((s) => s.me);
  const contacts = useStore((s) => s.contacts);
  const presence = useStore((s) => s.presence[id]);
  const typing = useStore((s) => s.typing[id]);
  const unlocked = useStore((s) => s.unlocked[id]);
  const wallpaper = useStore((s) => s.chats[id]?.wallpaper || s.settings.wallpaper);
  const [reply, setReply] = useState(null);
  const [editing, setEditing] = useState(null);
  const [sel, setSel] = useState(null);
  const scroller = useRef();
  const atBottom = useRef(true);

  useEffect(() => {
    if (id === core.AI_CHAT) return go('ai');
    core.loadMessages(id).then(() => core.markRead(id));
  }, [id]);
  useEffect(() => {
    if (msgs && document.visibilityState === 'visible') core.markRead(id);
  }, [msgs?.length]);
  useLayoutEffect(() => {
    const el = scroller.current;
    if (!el || !msgs) return;
    if (focus) {
      const t = document.getElementById('m-' + focus);
      if (t) return t.scrollIntoView({ block: 'center' });
    }
    if (atBottom.current) el.scrollTop = el.scrollHeight;
  }, [msgs?.length, typing]);

  if (!chat) return <div class="screen"><Header title="Chat not found" /></div>;
  if (chat.locked && !unlocked) return <LockGate chat={chat} />;

  const contact = contacts[id];
  const isTyping = typing && typing.until > Date.now();
  const name = chat.type === 'direct' ? contact?.alias || contact?.name || chat.name : chat.name;
  let sub = '';
  if (isTyping) sub = chat.type === 'direct' ? 'typing…' : `${core.displayName(typing.from)} is typing…`;
  else if (chat.type === 'direct') sub = lastSeen(presence) || (contact?.postcode ? pcDisplay(contact.postcode) : 'tap for info');
  else if (chat.type === 'group') sub = (chat.members || []).map((m) => core.displayName(m).split(' ')[0]).join(', ');
  else if (chat.type === 'broadcast') sub = `${(chat.members || []).length - 1} recipients`;
  else if (chat.type === 'channel') sub = chat.owner === me.id ? `${(chat.followers || []).length} followers` : 'Channel';
  else if (chat.type === 'self') sub = 'Message yourself';

  const canSend = !chat.left && !(chat.type === 'channel' && chat.owner !== me.id) && !(chat.onlyAdmins && !(chat.admins || []).includes(me.id)) && !contact?.blocked;

  function onAction(m) {
    setSel(m.id);
    const own = m.from === me.id;
    const edit = own && m.kind === 'text' && !m.deleted && Date.now() - m.ts < 15 * 60000;
    sheet(
      <div>
        <div class="react-bar">
          {REACTIONS.map((e) => (
            <button class={m.reactions?.[me.id] === e ? 'on' : ''} onClick={() => (core.reactTo(id, m.id, e), setState({ sheet: null }), setSel(null))}>{e}</button>
          ))}
        </div>
        <Menu
          items={[
            !m.deleted && canSend && { icon: 'reply', label: 'Reply', onClick: () => setReply(m) },
            m.text && { icon: 'copy', label: 'Copy', onClick: () => (navigator.clipboard?.writeText(m.text), toast('Copied')) },
            !m.deleted && { icon: 'forward', label: 'Forward', onClick: () => forwardSheet(m) },
            { icon: 'star', label: m.starred ? 'Unstar' : 'Star', onClick: () => core.toggleStar(m.id) },
            edit && { icon: 'edit', label: 'Edit', onClick: () => setEditing(m) },
            own && chat.type !== 'self' && { icon: 'info', label: 'Message info', onClick: () => infoSheet(m, chat) },
            m.media && { icon: 'download', label: 'Save to device', onClick: async () => { const u = await core.blobUrl(m.media.blobId); const a = document.createElement('a'); a.href = u; a.download = m.media.name || `2qo-${m.id}`; a.click(); } },
            { icon: 'trash', label: 'Delete for me', danger: true, onClick: () => core.deleteMessage(id, m.id, false) },
            own && !m.deleted && chat.type !== 'self' && Date.now() - m.ts < 2 * 86400000 && { icon: 'trash', label: 'Delete for everyone', danger: true, onClick: () => core.deleteMessage(id, m.id, true).catch((e) => toast(e.message)) },
          ]}
        />
      </div>,
    );
    setTimeout(() => !getState().sheet && setSel(null), 300);
  }

  let lastDay = '';
  return (
    <div class="screen">
      <Header
        title={name}
        sub={sub}
        avatar={<div onClick={() => go('chatinfo', { id })}>{chatAvatar(chat, contacts, 40)}</div>}
        onTitle={() => go('chatinfo', { id })}
        actions={
          <>
            {chat.type === 'direct' && (
              <>
                <IconBtn name="video" label="Video call" onClick={() => startCall(id, true)} />
                <IconBtn name="phone" label="Voice call" onClick={() => startCall(id, false)} />
              </>
            )}
            <IconBtn name="more" label="More" onClick={() => chatMoreMenu(chat)} />
          </>
        }
      />
      <div
        class={'conv wp-' + wallpaper}
        ref={scroller}
        onScroll={(e) => {
          const el = e.currentTarget;
          atBottom.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
        }}
      >
        {chat.disappearing > 0 && <div class="sys">⏱️ Disappearing messages: {core.humanDuration(chat.disappearing)}</div>}
        <div class="sys">🔐 Messages are end-to-end encrypted. Only people in this chat can read them.</div>
        {(msgs || []).map((m, i) => {
          const d = dayLabel(m.ts);
          const showDay = d !== lastDay;
          lastDay = d;
          return (
            <>
              {showDay && <div class="day">{d}</div>}
              <Bubble key={m.id} m={m} chat={chat} prev={showDay ? null : msgs[i - 1]} mine={m.from === me.id} onAction={onAction} selected={sel === m.id} flash={focus === m.id} />
            </>
          );
        })}
        {isTyping && (
          <div class="typing">
            <i />
            <i />
            <i />
          </div>
        )}
      </div>
      {canSend ? (
        <Composer chat={chat} reply={reply} clearReply={() => setReply(null)} editing={editing} clearEdit={() => setEditing(null)} />
      ) : (
        <div class="sys" style={{ margin: 12 }}>
          {contact?.blocked ? 'You blocked this contact. Unblock in contact info to message.' : chat.left ? 'You are no longer a member.' : chat.type === 'channel' ? 'Only the channel owner can post.' : 'Only admins can send messages.'}
        </div>
      )}
    </div>
  );
}

function chatMoreMenu(chat) {
  sheet(
    <Menu
      items={[
        { icon: 'info', label: chat.type === 'direct' ? 'View contact' : 'Info', onClick: () => go('chatinfo', { id: chat.id }) },
        { icon: 'search', label: 'Search in chat', onClick: () => go('search') },
        { icon: chat.muted ? 'bell' : 'belloff', label: chat.muted ? 'Unmute' : 'Mute', onClick: () => core.patchChat(chat.id, { muted: !chat.muted }) },
        ['direct', 'group'].includes(chat.type) && { icon: 'timer', label: 'Disappearing messages', onClick: () => disappearingSheet(chat) },
        { icon: 'image', label: 'Wallpaper', onClick: () => wallpaperSheet(chat) },
        { icon: 'trash', label: 'Clear chat', danger: true, onClick: () => confirm('Clear all messages (starred are kept)?') && core.clearChat(chat.id) },
      ]}
    />,
  );
}

export function disappearingSheet(chat) {
  const opts = [
    [0, 'Off'],
    [86400, '24 hours'],
    [7 * 86400, '7 days'],
    [90 * 86400, '90 days'],
  ];
  sheet(<Menu title="Disappearing messages" items={opts.map(([s, l]) => ({ label: (chat.disappearing === s || (!chat.disappearing && !s) ? '● ' : '○ ') + l, onClick: () => core.setDisappearing(chat.id, s) }))} />);
}

export function wallpaperSheet(chat) {
  sheet(
    <Menu
      title="Chat wallpaper"
      items={[
        ['grid', 'Dots'],
        ['waves', 'Waves'],
        ['sun', 'Sunrise'],
        ['plain', 'Plain'],
      ].map(([k, l]) => ({ label: l, onClick: () => core.patchChat(chat.id, { wallpaper: k }) }))}
    />,
  );
}

function infoSheet(m, chat) {
  const rows = [];
  if (chat.type === 'group') {
    for (const uid of (chat.members || []).filter((x) => x !== getState().me.id)) {
      rows.push({ label: `${core.displayName(uid)} — ${m.readBy?.[uid] ? 'read ' + clock(m.readBy[uid]) : m.deliveredTo?.[uid] ? 'delivered ' + clock(m.deliveredTo[uid]) : 'pending'}`, onClick: () => {} });
    }
  } else {
    rows.push({ label: `Sent ${new Date(m.ts).toLocaleString()}`, onClick: () => {} });
    if (m.deliveredAt) rows.push({ label: `Delivered ${new Date(m.deliveredAt).toLocaleString()}`, onClick: () => {} });
    if (m.readAt) rows.push({ label: `Read ${new Date(m.readAt).toLocaleString()}`, onClick: () => {} });
    rows.push({ label: `Status: ${m.status}`, onClick: () => {} });
  }
  sheet(<Menu title="Message info" items={rows} />);
}

export function forwardSheet(m) {
  function Pick() {
    const chats = useStore((s) => s.chats);
    const [picked, setPicked] = useState([]);
    const list = Object.values(chats).filter((c) => !['ai', 'community'].includes(c.type) && !c.left).sort((a, b) => (b.lastTs || 0) - (a.lastTs || 0));
    return (
      <div class="menu">
        <div class="menu-t">Forward to…</div>
        {list.map((c) => (
          <button class="menu-i" onClick={() => setPicked((p) => (p.includes(c.id) ? p.filter((x) => x !== c.id) : [...p, c.id]))}>
            <span class={'check' + (picked.includes(c.id) ? ' on' : '')}>{picked.includes(c.id) && <Icon name="check" size={14} />}</span>
            <span>{c.type === 'direct' ? core.displayName(c.id) : c.name}</span>
          </button>
        ))}
        <button class="btn block" disabled={!picked.length} onClick={async () => { setState({ sheet: null }); await core.forwardMessage(m, picked); toast(`Forwarded to ${picked.length} chat(s)`); }}>
          <Icon name="send" size={18} /> Send
        </button>
      </div>
    );
  }
  sheet(<Pick />);
}

// --------------------------------------------------------------- composer --
function Composer({ chat, reply, clearReply, editing, clearEdit }) {
  const enterToSend = useStore((s) => s.settings.enterToSend);
  const [text, setText] = useState('');
  const [rec, setRec] = useState(null);
  const [secs, setSecs] = useState(0);
  const ta = useRef();
  const lastTyping = useRef(0);

  useEffect(() => {
    if (editing) {
      setText(editing.text);
      ta.current?.focus();
    }
  }, [editing]);
  useEffect(() => {
    const el = ta.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = Math.min(140, el.scrollHeight) + 'px';
  }, [text]);

  async function send() {
    const t = text.trim();
    if (!t) return;
    setText('');
    try {
      if (editing) {
        await core.editMessage(chat.id, editing.id, t);
        clearEdit();
      } else {
        await core.sendMessage(chat.id, { kind: 'text', text: t, replyTo: reply?.id });
        clearReply();
      }
    } catch (e) {
      toast(e.message);
    }
  }

  function onInput(e) {
    setText(e.target.value);
    if (Date.now() - lastTyping.current > 3000) {
      lastTyping.current = Date.now();
      core.sendTyping(chat.id);
    }
  }

  async function toggleRec() {
    if (rec) return;
    try {
      const r = await startRecording('audio', { maxSeconds: 300, onTick: setSecs });
      setRec(r);
    } catch (e) {
      toast(e.message);
    }
  }
  async function finishRec(sendIt) {
    const r = rec;
    setRec(null);
    setSecs(0);
    if (!sendIt) return r.cancel();
    const out = await r.stop();
    if (out.duration < 1) return toast('Too short');
    await core.sendMessage(chat.id, { kind: 'audio', media: { blob: out.blob, mime: out.mime, duration: out.duration, dataUrl: await fileToDataURL(out.blob) }, replyTo: reply?.id });
    clearReply();
  }

  return (
    <>
      {(reply || editing) && (
        <div class="replybar">
          <Icon name={editing ? 'edit' : 'reply'} size={18} />
          <div>
            <b>{editing ? 'Edit message' : core.displayName(reply.from)}</b> · {core.preview(editing || reply)}
          </div>
          <IconBtn name="close" label="Cancel" size={18} onClick={() => (editing ? (clearEdit(), setText('')) : clearReply())} />
        </div>
      )}
      <div class="composer">
        {rec ? (
          <div class="recbar">
            <i class="blink" />
            {fmtDuration(secs)}
            <span class="spacer" />
            <IconBtn name="trash" label="Discard" onClick={() => finishRec(false)} />
          </div>
        ) : (
          <div class="cbox">
            <IconBtn name="smile" label="Emoji" onClick={() => emojiSheet((e) => setText((t) => t + e))} />
            <textarea
              ref={ta}
              rows={1}
              value={text}
              placeholder={chat.type === 'broadcast' ? 'Broadcast message' : 'Message'}
              onInput={onInput}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey && enterToSend) {
                  e.preventDefault();
                  send();
                }
              }}
            />
            {!editing && <IconBtn name="attach" label="Attach" onClick={() => attachSheet(chat, reply, clearReply)} />}
            {!text && !editing && <IconBtn name="camera" label="Camera" onClick={() => pickFile(chat, 'image/*,video/*', 'environment')} />}
          </div>
        )}
        {text.trim() || editing ? (
          <button class="sendbtn" onClick={send} aria-label="Send">
            <Icon name={editing ? 'check' : 'send'} />
          </button>
        ) : rec ? (
          <button class="sendbtn" onClick={() => finishRec(true)} aria-label="Send voice note">
            <Icon name="send" />
          </button>
        ) : (
          <button class="sendbtn" onClick={toggleRec} aria-label="Record voice note">
            <Icon name="mic" />
          </button>
        )}
      </div>
    </>
  );
}

export function emojiSheet(onPick) {
  sheet(
    <div class="emoji-grid">
      {EMOJI.map((e) => (
        <button onClick={() => onPick(e)}>{e}</button>
      ))}
    </div>,
  );
}

async function sendFile(chat, file, caption = '') {
  try {
    if (file.size > 64 * 1048576) return toast('Files up to 64 MB can be sent');
    if (file.type.startsWith('image/') && !file.type.includes('gif')) {
      const { blob } = await compressImage(file);
      return core.sendMessage(chat.id, { kind: 'image', text: caption, media: { blob, mime: 'image/jpeg', name: file.name, dataUrl: await fileToDataURL(blob) } });
    }
    const kind = file.type.startsWith('video/') ? 'video' : file.type.startsWith('audio/') ? 'audio' : file.type.startsWith('image/') ? 'image' : 'file';
    return core.sendMessage(chat.id, { kind, text: caption, media: { blob: file, mime: file.type, name: file.name, dataUrl: await fileToDataURL(file) } });
  } catch (e) {
    toast(e.message);
  }
}

function pickFile(chat, accept, capture) {
  const i = document.createElement('input');
  i.type = 'file';
  i.accept = accept;
  i.multiple = !capture;
  if (capture) i.capture = capture;
  i.onchange = async () => {
    for (const f of i.files) await sendFile(chat, f);
  };
  i.click();
}

function attachSheet(chat) {
  const items = [
    ['image', 'Gallery', '#7b5cff', () => pickFile(chat, 'image/*,video/*')],
    ['camera', 'Camera', '#e0485d', () => pickFile(chat, 'image/*,video/*', 'environment')],
    ['file', 'Document', '#1769e0', () => pickFile(chat, '*/*')],
    ['location', 'Location', '#18b26b', () => shareLocation(chat)],
    ['user', 'Contact', '#e08a00', () => contactPicker(chat)],
    ['poll', 'Poll', '#0f9d6a', () => pollSheet(chat)],
    ['qr', 'My card', '#5b3df5', () => core.sendMessage(chat.id, { kind: 'contact', contact: core.contactCard() })],
    ['siren', 'SOS here', '#ef3b4a', () => go('sos')],
  ];
  sheet(
    <div class="attach-grid">
      {items.map(([icon, label, color, fn]) => (
        <button onClick={() => (setState({ sheet: null }), fn())}>
          <div style={{ background: color }}>
            <Icon name={icon} size={26} />
          </div>
          {label}
        </button>
      ))}
    </div>,
  );
}

async function shareLocation(chat) {
  toast('Getting location…');
  try {
    const loc = await locate();
    const r = await reverse(loc.lat, loc.lng, 100);
    await core.sendMessage(chat.id, { kind: 'location', location: { lat: loc.lat, lng: loc.lng, accuracy: loc.accuracy, postcode: r.unit?.postcode || getState().me.postcode || null } });
  } catch (e) {
    toast(e.message);
  }
}

function contactPicker(chat) {
  const list = Object.values(getState().contacts).filter((c) => c.saved);
  if (!list.length) return toast('No saved contacts yet');
  sheet(<Menu title="Share contact" items={list.map((c) => ({ icon: 'user', label: c.name, onClick: () => core.sendMessage(chat.id, { kind: 'contact', contact: { id: c.id, name: c.name, postcode: c.postcode, publicJwk: c.publicJwk, t: '2qo-contact' } }) }))} />);
}

function pollSheet(chat) {
  function PollForm() {
    const [q, setQ] = useState('');
    const [opts, setOpts] = useState(['', '']);
    const [multi, setMulti] = useState(false);
    const valid = q.trim() && opts.filter((o) => o.trim()).length >= 2;
    return (
      <div class="pad">
        <h3 style={{ marginTop: 0 }}>Create poll</h3>
        <Field label="Question">
          <input class="inp" value={q} onInput={(e) => setQ(e.target.value)} placeholder="Ask something" autoFocus />
        </Field>
        {opts.map((o, i) => (
          <input class="inp" style={{ marginBottom: 8 }} value={o} placeholder={`Option ${i + 1}`} onInput={(e) => {
            const n = [...opts];
            n[i] = e.target.value;
            if (i === n.length - 1 && e.target.value && n.length < 12) n.push('');
            setOpts(n);
          }} />
        ))}
        <label class="row" style={{ padding: '8px 0' }}>
          <div class="row-b">Allow multiple answers</div>
          <input type="checkbox" checked={multi} onChange={(e) => setMulti(e.target.checked)} />
        </label>
        <button class="btn block" disabled={!valid} onClick={() => { setState({ sheet: null }); core.sendMessage(chat.id, { kind: 'poll', poll: { question: q.trim(), multi, options: opts.filter((o) => o.trim()).map((t) => ({ text: t.trim(), votes: [] })) } }); }}>
          Send poll
        </button>
      </div>
    );
  }
  sheet(<PollForm />);
}
