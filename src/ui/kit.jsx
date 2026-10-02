import { useEffect, useState, useRef } from 'preact/hooks';
import { back, setState, useStore } from '../lib/store.js';
import { blobUrl } from '../lib/core.js';

// ---------------------------------------------------------------- icons ----
const P = {
  chat: 'M4 5.5A2.5 2.5 0 0 1 6.5 3h11A2.5 2.5 0 0 1 20 5.5v9a2.5 2.5 0 0 1-2.5 2.5H9l-4.2 3.4A.5.5 0 0 1 4 20V5.5Z',
  moments: 'M12 3a9 9 0 1 0 9 9M12 7.5a4.5 4.5 0 1 0 4.5 4.5M21 3l-5 5',
  calls: 'M5 4h3.5l1.8 4.5-2.3 1.4a11 11 0 0 0 6.1 6.1l1.4-2.3L20 15.5V19a1.5 1.5 0 0 1-1.6 1.5A16.5 16.5 0 0 1 3.5 5.6 1.5 1.5 0 0 1 5 4Z',
  nearby: 'M12 21s-6.5-5.6-6.5-11a6.5 6.5 0 1 1 13 0c0 5.4-6.5 11-6.5 11Zm0-8.5a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5Z',
  back: 'M15 5l-7 7 7 7',
  search: 'M11 4a7 7 0 1 0 0 14 7 7 0 0 0 0-14Zm9 16-4-4',
  more: 'M12 6.5a1.2 1.2 0 1 0 0-2.4 1.2 1.2 0 0 0 0 2.4Zm0 6.7a1.2 1.2 0 1 0 0-2.4 1.2 1.2 0 0 0 0 2.4Zm0 6.7a1.2 1.2 0 1 0 0-2.4 1.2 1.2 0 0 0 0 2.4Z',
  send: 'M4 12 20 4l-4.5 16-3.5-6.5L4 12Zm8 1.5L20 4',
  mic: 'M12 3a3 3 0 0 0-3 3v6a3 3 0 0 0 6 0V6a3 3 0 0 0-3-3Zm-6 9a6 6 0 0 0 12 0M12 18v3',
  attach: 'M20 11.5 12 19.5a5 5 0 0 1-7-7l8.5-8.5a3.3 3.3 0 0 1 4.7 4.7L9.7 17.2a1.7 1.7 0 0 1-2.4-2.4L15 7',
  camera: 'M4 8h3l1.5-2.5h7L17 8h3v11H4V8Zm8 9a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7Z',
  video: 'M3 7h12v10H3zM15 10.5l6-3.5v10l-6-3.5',
  phone: 'M5 4h3.5l1.8 4.5-2.3 1.4a11 11 0 0 0 6.1 6.1l1.4-2.3L20 15.5V19a1.5 1.5 0 0 1-1.6 1.5A16.5 16.5 0 0 1 3.5 5.6 1.5 1.5 0 0 1 5 4Z',
  plus: 'M12 5v14M5 12h14',
  close: 'M6 6l12 12M18 6 6 18',
  check: 'M5 12.5l4.5 4.5L19 7.5',
  check2: 'M2.5 12.5l4.5 4.5L16.5 7.5M10 16l1 1 9.5-9.5',
  clock: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18Zm0-13.5V12l3 2',
  smile: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18ZM8.5 14.5s1.2 2 3.5 2 3.5-2 3.5-2M9 9.5h.01M15 9.5h.01',
  image: 'M4 5h16v14H4zM4 15l4.5-4.5 4 4 2.5-2.5L20 17M15.5 9.5h.01',
  file: 'M6 3h8l4 4v14H6V3Zm8 0v4h4',
  pin: 'M15 3l6 6-3 1-4 4 .5 4.5L13 20l-4-4-5 5M9 16l-5-5 1.5-1.5L10 10l4-4 1-3',
  location: 'M12 21s-6.5-5.6-6.5-11a6.5 6.5 0 1 1 13 0c0 5.4-6.5 11-6.5 11Zm0-8.5a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5Z',
  user: 'M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8Zm-7.5 9a7.5 7.5 0 0 1 15 0',
  users: 'M9 11a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7Zm-6 9a6 6 0 0 1 12 0M16 4.5a3.5 3.5 0 0 1 0 6.5M18 14a6 6 0 0 1 3 6',
  poll: 'M5 20V10M12 20V4M19 20v-7',
  star: 'M12 3.5l2.6 5.4 5.9.8-4.3 4.1 1 5.8L12 16.8 6.8 19.6l1-5.8L3.5 9.7l5.9-.8L12 3.5Z',
  reply: 'M10 8 4 13l6 5M4 13h10a6 6 0 0 1 6 6',
  forward: 'M14 8l6 5-6 5M20 13H10a6 6 0 0 0-6 6',
  copy: 'M8 8h12v12H8zM4 16V4h12',
  trash: 'M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13',
  edit: 'M4 20h4L19 9l-4-4L4 16v4ZM14 6l4 4',
  info: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18Zm0-10v6m0-9h.01',
  bell: 'M6 16V11a6 6 0 1 1 12 0v5l1.5 2h-15L6 16Zm4 4h4',
  belloff: 'M6 16V11a6 6 0 0 1 9.5-4.9M18 11v5l1.5 2H8M10 20h4M3 3l18 18',
  lock: 'M6 11h12v9H6zM8.5 11V8a3.5 3.5 0 0 1 7 0v3',
  archive: 'M4 5h16v4H4zM5.5 9v10h13V9M10 13h4',
  settings: 'M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6ZM19.4 13.5l1.6 1.2-2 3.4-1.9-.7a7 7 0 0 1-1.7 1L15 20.5h-4l-.4-2.1a7 7 0 0 1-1.7-1l-1.9.7-2-3.4 1.6-1.2a7 7 0 0 1 0-3L4.9 9.3l2-3.4 1.9.7a7 7 0 0 1 1.7-1L11 3.5h4l.4 2.1a7 7 0 0 1 1.7 1l1.9-.7 2 3.4-1.6 1.2a7 7 0 0 1 0 3Z',
  wifi: 'M2 9a15 15 0 0 1 20 0M5.5 12.5a10 10 0 0 1 13 0M9 16a5 5 0 0 1 6 0M12 19.5h.01',
  wifioff: 'M2 9a15 15 0 0 1 6-3.4M22 9a15 15 0 0 0-9.5-3.8M5.5 12.5a10 10 0 0 1 4-2.2M18.5 12.5a10 10 0 0 0-2-1.4M9 16a5 5 0 0 1 6 0M12 19.5h.01M3 3l18 18',
  link: 'M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1',
  qr: 'M4 4h6v6H4zM14 4h6v6h-6zM4 14h6v6H4zM14 14h2v2h-2zM18 14h2v2M14 18h2v2M18 18h2v2',
  shield: 'M12 3l8 3v6c0 5-3.5 8-8 9-4.5-1-8-4-8-9V6l8-3Z',
  siren: 'M7 18v-6a5 5 0 0 1 10 0v6M5 18h14v3H5zM12 3v2M4.5 6.5l1.4 1.4M19.5 6.5l-1.4 1.4',
  sparkle: 'M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8L12 3ZM19 16l.8 2.2L22 19l-2.2.8L19 22l-.8-2.2L16 19l2.2-.8L19 16Z',
  channel: 'M4 10v4h3l6 4V6L7 10H4Zm13-1.5a5 5 0 0 1 0 7M19.5 6a8.5 8.5 0 0 1 0 12',
  community: 'M12 8a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5ZM5 14a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5Zm14 0a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5ZM8.5 21a3.5 3.5 0 0 1 7 0M1.5 21a3.5 3.5 0 0 1 7 0M15.5 21a3.5 3.5 0 0 1 7 0',
  broadcast: 'M12 13a1.5 1.5 0 1 0 0-3 1.5 1.5 0 0 0 0 3ZM8 15.5a5 5 0 0 1 0-7M16 8.5a5 5 0 0 1 0 7M5 18.5a9 9 0 0 1 0-14M19 4.5a9 9 0 0 1 0 14',
  download: 'M12 4v11m-5-5 5 5 5-5M5 20h14',
  upload: 'M12 20V9m-5 5 5-5 5 5M5 4h14',
  flip: 'M4 12a8 8 0 0 1 14-5.3M20 12a8 8 0 0 1-14 5.3M18 3v4h-4M6 21v-4h4',
  hangup: 'M3 15.5c5-5 13-5 18 0l-2 2.5-3.5-1.5V14a10 10 0 0 0-7 0v2.5L5 18l-2-2.5Z',
  micoff: 'M9 9v3a3 3 0 0 0 5 2.2M15 10V6a3 3 0 0 0-5.7-1.3M6 12a6 6 0 0 0 9.6 4.8M18 12a6 6 0 0 1-.5 2.4M12 18v3M3 3l18 18',
  videooff: 'M3 7h3m4 0h5v5m0 4v1H3V7M15 10.5l6-3.5v10l-3-1.7M3 3l18 18',
  speaker: 'M4 9.5v5h3.5L12 18V6L7.5 9.5H4Zm12 0a3.5 3.5 0 0 1 0 5M18.5 7a7 7 0 0 1 0 10',
  eye: 'M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12Zm10 3a3 3 0 1 0 0-6 3 3 0 0 0 0 6Z',
  globe: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18ZM3 12h18M12 3c2.5 2.5 3.5 5.5 3.5 9s-1 6.5-3.5 9c-2.5-2.5-3.5-5.5-3.5-9s1-6.5 3.5-9Z',
  play: 'M7 4.5v15l12-7.5-12-7.5Z',
  pause: 'M7 4h3.5v16H7zM13.5 4H17v16h-3.5z',
  stop: 'M6 6h12v12H6z',
  timer: 'M12 21a8 8 0 1 0 0-16 8 8 0 0 0 0 16Zm0-12v4l2.5 2.5M9.5 2.5h5',
  key: 'M14.5 9.5a4.5 4.5 0 1 1-1.3-3.2M14.5 9.5 21 16v3h-3v-2h-2v-2h-2l-1.3-1.3',
  sun: 'M12 16a4 4 0 1 0 0-8 4 4 0 0 0 0 8ZM12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4',
  music: 'M9 18V5l11-2v13M9 18a3 3 0 1 1-6 0 3 3 0 0 1 6 0Zm11-2a3 3 0 1 1-6 0 3 3 0 0 1 6 0Z',
  hub: 'M12 14a2 2 0 1 0 0-4 2 2 0 0 0 0 4ZM5 6a2 2 0 1 0 0-4 2 2 0 0 0 0 4Zm14 0a2 2 0 1 0 0-4 2 2 0 0 0 0 4ZM5 22a2 2 0 1 0 0-4 2 2 0 0 0 0 4Zm14 0a2 2 0 1 0 0-4 2 2 0 0 0 0 4ZM6.5 5.5l4 5M17.5 5.5l-4 5M6.5 18.5l4-5M17.5 18.5l-4-5',
};

export function Icon({ name, size = 22, fill = false, class: cls = '', stroke = 1.8 }) {
  return (
    <svg class={'ic ' + cls} width={size} height={size} viewBox="0 0 24 24" fill={fill ? 'currentColor' : 'none'} stroke="currentColor" stroke-width={stroke} stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
      <path d={P[name] || P.info} />
    </svg>
  );
}

export function Logo({ size = 28 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 64 64" aria-label="2qo">
      <defs>
        <linearGradient id="lg2qo" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stop-color="#7b5cff" />
          <stop offset="1" stop-color="#3a1fd1" />
        </linearGradient>
      </defs>
      <rect width="64" height="64" rx="18" fill="url(#lg2qo)" />
      <path d="M17 26a8 8 0 0 1 15 0c0 5-15 10-15 16h15" fill="none" stroke="#fff" stroke-width="5" stroke-linecap="round" stroke-linejoin="round" />
      <circle cx="44" cy="35" r="8" fill="none" stroke="#ffc83d" stroke-width="5" />
      <path d="M49 41l5 5" stroke="#ffc83d" stroke-width="5" stroke-linecap="round" />
    </svg>
  );
}

// --------------------------------------------------------------- avatar ----
const HUES = [262, 200, 340, 28, 160, 230, 300, 12, 190, 45];
export function hue(id = '') {
  let h = 0;
  for (const c of String(id)) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  return HUES[h % HUES.length];
}

export function Avatar({ id, name, src, size = 46, ring = false, online = false, icon }) {
  const initials = String(name || '?')
    .split(/\s+/)
    .map((w) => w[0])
    .slice(0, 2)
    .join('')
    .toUpperCase();
  const h = hue(id || name);
  return (
    <div class={'avatar' + (ring ? ' ring' : '')} style={{ width: size, height: size, '--h': h, fontSize: size * 0.38 }}>
      {src ? <img src={src} alt="" /> : icon ? <Icon name={icon} size={size * 0.5} /> : <span>{initials}</span>}
      {online && <i class="dot-online" />}
    </div>
  );
}

// --------------------------------------------------------------- layout ----
export function Header({ title, sub, onBack = back, actions, avatar, onTitle, transparent }) {
  return (
    <header class={'hdr' + (transparent ? ' clear' : '')}>
      {onBack && (
        <button class="ibtn" onClick={onBack} aria-label="Back">
          <Icon name="back" />
        </button>
      )}
      {avatar}
      <div class="hdr-t" onClick={onTitle} role={onTitle ? 'button' : undefined}>
        <h1>{title}</h1>
        {sub && <small>{sub}</small>}
      </div>
      <div class="hdr-a">{actions}</div>
    </header>
  );
}

export function IconBtn({ name, label, onClick, active, size, class: cls = '' }) {
  return (
    <button class={'ibtn ' + (active ? 'on ' : '') + cls} onClick={onClick} aria-label={label} title={label}>
      <Icon name={name} size={size} />
    </button>
  );
}

export function Row({ icon, avatar, title, sub, right, onClick, danger, children }) {
  return (
    <div class={'row' + (onClick ? ' tap' : '') + (danger ? ' danger' : '')} onClick={onClick} role={onClick ? 'button' : undefined} tabIndex={onClick ? 0 : undefined}>
      {avatar || (icon && <div class="row-ic"><Icon name={icon} /></div>)}
      <div class="row-b">
        <div class="row-t">{title}</div>
        {sub && <div class="row-s">{sub}</div>}
        {children}
      </div>
      {right && <div class="row-r">{right}</div>}
    </div>
  );
}

export function Toggle({ checked, onChange, label }) {
  return (
    <label class="toggle" aria-label={label}>
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} />
      <span />
    </label>
  );
}

export function Empty({ icon = 'chat', title, children }) {
  return (
    <div class="empty">
      <div class="empty-ic">
        <Icon name={icon} size={34} />
      </div>
      <h3>{title}</h3>
      <div class="muted">{children}</div>
    </div>
  );
}

export function Section({ title, children }) {
  return (
    <section class="sect">
      {title && <h4>{title}</h4>}
      <div class="card">{children}</div>
    </section>
  );
}

/** Bottom sheet for menus. `items`: [{icon,label,onClick,danger}] */
export function Menu({ items, title }) {
  return (
    <div class="menu">
      {title && <div class="menu-t">{title}</div>}
      {items.filter(Boolean).map((it) => (
        <button
          class={'menu-i' + (it.danger ? ' danger' : '')}
          onClick={() => {
            setState({ sheet: null });
            it.onClick();
          }}
        >
          {it.icon && <Icon name={it.icon} size={20} />}
          <span>{it.label}</span>
          {it.hint && <small>{it.hint}</small>}
        </button>
      ))}
    </div>
  );
}

export function SheetHost() {
  const sheet = useStore((s) => s.sheet);
  if (!sheet) return null;
  return (
    <div class="sheet-bg" onClick={() => setState({ sheet: null })}>
      <div class="sheet" onClick={(e) => e.stopPropagation()}>
        <div class="grab" />
        {sheet}
      </div>
    </div>
  );
}

export function Toast() {
  const t = useStore((s) => s.toast);
  return t ? <div class="toast" role="status">{t}</div> : null;
}

// ---------------------------------------------------------------- media ----
export function useBlobUrl(blobId) {
  const [u, set] = useState(null);
  useEffect(() => {
    let on = true;
    blobUrl(blobId).then((x) => on && set(x));
    return () => (on = false);
  }, [blobId]);
  return u;
}

export function Video({ stream, muted, mirror, class: cls }) {
  const ref = useRef();
  useEffect(() => {
    if (ref.current && stream) ref.current.srcObject = stream;
  }, [stream]);
  return <video ref={ref} class={cls + (mirror ? ' mirror' : '')} autoPlay playsInline muted={muted} />;
}

// ----------------------------------------------------------------- time ----
export function timeShort(ts) {
  if (!ts) return '';
  const d = new Date(ts);
  const now = new Date();
  if (d.toDateString() === now.toDateString()) return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  const y = new Date(now);
  y.setDate(now.getDate() - 1);
  if (d.toDateString() === y.toDateString()) return 'Yesterday';
  if (now - d < 6 * 86400000) return d.toLocaleDateString([], { weekday: 'short' });
  return d.toLocaleDateString([], { day: 'numeric', month: 'short', year: d.getFullYear() !== now.getFullYear() ? '2-digit' : undefined });
}

export function clock(ts) {
  return new Date(ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

export function dayLabel(ts) {
  const d = new Date(ts);
  const now = new Date();
  if (d.toDateString() === now.toDateString()) return 'Today';
  const y = new Date(now);
  y.setDate(now.getDate() - 1);
  if (d.toDateString() === y.toDateString()) return 'Yesterday';
  return d.toLocaleDateString([], { weekday: 'long', day: 'numeric', month: 'long', year: d.getFullYear() !== now.getFullYear() ? 'numeric' : undefined });
}

export function lastSeen(p) {
  if (!p) return '';
  if (p.online && Date.now() - (p.lastSeen || 0) < 120000) return 'online';
  if (!p.lastSeen) return '';
  return 'last seen ' + timeShort(p.lastSeen).toLowerCase() + (Date.now() - p.lastSeen < 86400000 ? '' : '');
}

export function PostcodeChip({ code, onClick }) {
  if (!code) return null;
  return (
    <span class="pc-chip" onClick={onClick}>
      <Icon name="location" size={12} />
      {String(code).replace(/-/g, ' ')}
    </span>
  );
}

export function Field({ label, children, hint }) {
  return (
    <label class="field">
      <span>{label}</span>
      {children}
      {hint && <small class="muted">{hint}</small>}
    </label>
  );
}
