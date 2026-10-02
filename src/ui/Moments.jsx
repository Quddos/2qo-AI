import { useEffect, useRef, useState } from 'preact/hooks';
import { useStore, go, sheet, toast, setState, getState } from '../lib/store.js';
import * as core from '../lib/core.js';
import { Avatar, Header, Icon, IconBtn, Empty, Menu, timeShort, Logo } from './kit.jsx';
import { NetPill } from './Chats.jsx';
import { compressImage, fileToDataURL } from '../lib/media.js';

const BGS = ['#5b3df5', '#e0485d', '#0f9d6a', '#1769e0', '#e08a00', '#17142b', '#a63ad6', '#00897b'];
const FONTS = ['inherit', 'Georgia, serif', 'ui-monospace, monospace', '"Comic Sans MS", cursive'];

function group(statuses, meId) {
  const by = {};
  for (const s of statuses.sort((a, b) => a.ts - b.ts)) (by[s.from] ||= []).push(s);
  const mine = by[meId] || [];
  delete by[meId];
  const others = Object.entries(by).map(([from, list]) => ({ from, list, unseen: list.some((s) => !s.viewed), last: list[list.length - 1].ts }));
  others.sort((a, b) => b.unseen - a.unseen || b.last - a.last);
  return { mine, others };
}

function cardStyle(s, url) {
  if (s.kind === 'text') return { background: s.bg };
  return { backgroundImage: url ? `url(${url})` : undefined, background: url ? undefined : '#333' };
}

export function Moments() {
  const statuses = useStore((s) => s.statuses);
  const me = useStore((s) => s.me);
  const contacts = useStore((s) => s.contacts);
  const [viewing, setViewing] = useState(null);
  const [composing, setComposing] = useState(false);
  const { mine, others } = group(statuses.slice(), me.id);
  const fileRef = useRef();

  async function onFile(e) {
    const f = e.target.files[0];
    if (!f) return;
    if (f.type.startsWith('video/')) {
      if (f.size > 16 * 1048576) return toast('Videos up to 16 MB');
      const caption = prompt('Add a caption (optional)') || '';
      await core.postStatus({ kind: 'video', text: caption, media: await fileToDataURL(f) });
    } else {
      const { blob } = await compressImage(f, 1280, 0.8);
      const caption = prompt('Add a caption (optional)') || '';
      await core.postStatus({ kind: 'image', text: caption, media: await fileToDataURL(blob) });
    }
    toast('Moment shared');
  }

  return (
    <div class="screen">
      <header class="hdr">
        <div class="brand"><b style={{ fontSize: '1.35rem' }}>Moments</b></div>
        <div class="spacer" />
        <NetPill />
        <IconBtn name="channel" label="Channels" onClick={() => go('channels')} />
        <IconBtn name="community" label="Communities" onClick={() => go('communities')} />
      </header>
      <div class="scroll with-dock">
        <div class="mstrip">
          <button onClick={() => (mine.length ? setViewing({ list: mine, i: 0, own: true }) : setComposing(true))}>
            <div style={{ position: 'relative' }}>
              <Avatar id={me.id} name={me.name} src={me.avatar} size={64} ring={mine.length > 0} />
              <span class="badge" style={{ position: 'absolute', right: -4, bottom: -4, background: 'var(--sun)', color: '#231800' }}>+</span>
            </div>
            <span>My moment</span>
          </button>
          {others.map((g) => (
            <button onClick={() => setViewing({ list: g.list, i: Math.max(0, g.list.findIndex((s) => !s.viewed)) })}>
              <Avatar id={g.from} name={core.displayName(g.from)} src={contacts[g.from]?.avatar} size={64} ring={g.unseen} />
              <span>{core.displayName(g.from).split(' ')[0]}</span>
            </button>
          ))}
        </div>
        <div class="btns" style={{ padding: '0 16px 14px' }}>
          <button class="btn" onClick={() => setComposing(true)}><Icon name="edit" size={18} /> Text</button>
          <button class="btn sun" onClick={() => fileRef.current.click()}><Icon name="camera" size={18} /> Photo / video</button>
          <input ref={fileRef} type="file" accept="image/*,video/*" hidden onChange={onFile} />
        </div>
        {others.length ? (
          <div class="mcard-grid">
            {others.map((g) => {
              const s = g.list[g.list.length - 1];
              return (
                <div class={'mcard' + (g.unseen ? '' : ' seen')} style={cardStyle(s, s.media)} onClick={() => setViewing({ list: g.list, i: Math.max(0, g.list.findIndex((x) => !x.viewed)) })}>
                  {s.kind === 'text' && <div class="mtext" style={{ fontFamily: FONTS[s.font || 0] }}>{s.text}</div>}
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <Avatar id={g.from} name={core.displayName(g.from)} src={contacts[g.from]?.avatar} size={30} ring={g.unseen} />
                    <div>
                      <div>{core.displayName(g.from).split(' ')[0]}</div>
                      <small style={{ opacity: 0.85, fontWeight: 500 }}>{timeShort(s.ts)}</small>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        ) : (
          <Empty icon="moments" title="No moments yet">Moments from contacts you’ve saved appear here for 24 hours. Share yours — it reaches contacts over any link, even offline.</Empty>
        )}
      </div>
      {viewing && <Viewer {...viewing} onClose={() => setViewing(null)} />}
      {composing && <TextComposer onClose={() => setComposing(false)} />}
    </div>
  );
}

function TextComposer({ onClose }) {
  const [text, setText] = useState('');
  const [bg, setBg] = useState(0);
  const [font, setFont] = useState(0);
  return (
    <div class="composer-status" style={{ background: BGS[bg] }}>
      <div class="hdr clear" style={{ color: '#fff' }}>
        <IconBtn name="close" label="Close" onClick={onClose} />
        <div class="spacer" />
        <button class="ibtn" style={{ color: '#fff', fontFamily: FONTS[font], fontWeight: 800 }} onClick={() => setFont((font + 1) % FONTS.length)}>Aa</button>
        <IconBtn name="sun" label="Colour" onClick={() => setBg((bg + 1) % BGS.length)} />
      </div>
      <textarea autoFocus value={text} maxLength={700} placeholder="Type a moment" onInput={(e) => setText(e.target.value)} style={{ fontFamily: FONTS[font] }} />
      <div class="swatches">{BGS.map((c, i) => <button style={{ background: c, borderColor: i === bg ? '#fff' : '#fff6' }} onClick={() => setBg(i)} />)}</div>
      <div style={{ display: 'flex', justifyContent: 'flex-end', padding: 16 }}>
        <button class="sendbtn" disabled={!text.trim()} onClick={async () => { await core.postStatus({ kind: 'text', text: text.trim(), bg: BGS[bg], font }); onClose(); toast('Moment shared'); }}>
          <Icon name="send" />
        </button>
      </div>
    </div>
  );
}

function Viewer({ list, i: start, own, onClose }) {
  const [i, setI] = useState(start);
  const [p, setP] = useState(0);
  const [paused, setPaused] = useState(false);
  const [reply, setReply] = useState('');
  const s = list[i];
  const vref = useRef();
  useEffect(() => {
    if (!s) return onClose();
    core.viewStatus(s);
    setP(0);
  }, [i]);
  useEffect(() => {
    if (paused || !s) return;
    const dur = s.kind === 'video' ? (vref.current?.duration || 15) * 1000 : 5000;
    const t = setInterval(() => setP((x) => {
      const n = x + 100 / (dur / 100);
      if (n >= 100) {
        clearInterval(t);
        if (i < list.length - 1) setI(i + 1);
        else onClose();
      }
      return n;
    }), 100);
    return () => clearInterval(t);
  }, [i, paused]);
  if (!s) return null;
  const views = Object.keys(s.views || {});
  return (
    <div class="viewer" style={s.kind === 'text' ? { background: s.bg } : null}>
      <div class="bars">{list.map((_, k) => <i><b style={{ width: k < i ? '100%' : k === i ? p + '%' : 0 }} /></i>)}</div>
      <div class="hdr clear" style={{ color: '#fff' }}>
        <IconBtn name="back" label="Close" onClick={onClose} />
        <Avatar id={s.from} name={core.displayName(s.from)} size={36} src={s.from === getState().me.id ? getState().me.avatar : getState().contacts[s.from]?.avatar} />
        <div class="hdr-t"><h1 style={{ fontSize: '1rem' }}>{core.displayName(s.from)}</h1><small style={{ color: '#fffa' }}>{timeShort(s.ts)}</small></div>
        {own && <IconBtn name="trash" label="Delete" onClick={() => core.deleteStatus(s.id).then(() => (list.length > 1 ? null : onClose()))} />}
      </div>
      <div class="vbody" onPointerDown={() => setPaused(true)} onPointerUp={() => setPaused(false)}>
        {s.kind === 'text' && <div class="vtext" style={{ fontFamily: FONTS[s.font || 0] }}>{s.text}</div>}
        {s.kind === 'image' && <img src={s.media} alt="" />}
        {s.kind === 'video' && <video ref={vref} src={s.media} autoPlay playsInline />}
        {s.kind !== 'text' && s.text && <div style={{ position: 'absolute', bottom: 16, left: 16, right: 16, textAlign: 'center', background: '#0007', padding: 10, borderRadius: 12 }}>{s.text}</div>}
        <div class="tapl" onClick={() => setI(Math.max(0, i - 1))} />
        <div class="tapr" onClick={() => (i < list.length - 1 ? setI(i + 1) : onClose())} />
      </div>
      <div class="vfoot">
        {own ? (
          <button class="btn ghost" style={{ color: '#fff', background: '#fff2' }} onClick={() => { setPaused(true); sheet(<Menu title={`Viewed by ${views.length}`} items={views.map((v) => ({ icon: 'eye', label: `${core.displayName(v)} · ${timeShort(s.views[v])}`, onClick: () => {} }))} />); }}>
            <Icon name="eye" size={18} /> {views.length}
          </button>
        ) : (
          <>
            <input class="inp" style={{ background: '#fff2', color: '#fff', border: 0 }} placeholder="Reply…" value={reply} onFocus={() => setPaused(true)} onBlur={() => setPaused(false)} onInput={(e) => setReply(e.target.value)} />
            <button class="sendbtn" onClick={async () => {
              if (!reply.trim()) return;
              await core.openDirect(s.from);
              await core.sendMessage(s.from, { kind: 'text', text: `↩︎ Moment: “${(s.text || (s.kind === 'image' ? '📷' : '🎥')).slice(0, 60)}”\n${reply.trim()}` });
              setReply('');
              toast('Reply sent');
            }}><Icon name="send" /></button>
            <button class="ibtn" style={{ color: '#fff', fontSize: 22 }} onClick={async () => { await core.openDirect(s.from); await core.sendMessage(s.from, { kind: 'text', text: `❤️ your moment: “${(s.text || '📷').slice(0, 60)}”` }); toast('❤️ sent'); }}>❤️</button>
          </>
        )}
      </div>
    </div>
  );
}
