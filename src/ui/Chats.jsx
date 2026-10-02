import { useEffect, useMemo, useState } from 'preact/hooks';
import { useStore, go, sheet, toast, getState } from '../lib/store.js';
import * as core from '../lib/core.js';
import { Avatar, Header, Icon, IconBtn, Empty, Menu, timeShort, PostcodeChip, Logo, clock } from './kit.jsx';

export function NetPill() {
  const net = useStore((s) => s.net);
  const label = net.hub === 'connected' ? 'Hub' + (net.peers.length ? ` + ${net.peers.length} P2P` : '') : net.peers.length ? `${net.peers.length} nearby` : net.online ? 'Local' : 'Offline';
  const cls = net.hub === 'connected' ? 'ok' : net.peers.length ? 'mesh' : '';
  return (
    <button class={'netpill ' + cls} onClick={() => go('connect')} title="Connections">
      <i />
      {label}
    </button>
  );
}

function chatName(chat, contacts) {
  if (chat.type === 'direct') return contacts[chat.id]?.alias || contacts[chat.id]?.name || chat.name;
  return chat.name;
}

export function chatAvatar(chat, contacts, size = 50) {
  if (chat.type === 'ai') return <div class="avatar" style={{ width: size, height: size, background: 'radial-gradient(circle at 30% 25%,#a58cff,#5b3df5 55%,#2a138f)', color: '#fff' }}><Icon name="sparkle" size={size * 0.5} /></div>;
  if (chat.type === 'self') return <Avatar id={getState().me.id} name={getState().me.name} src={getState().me.avatar} size={size} />;
  const c = contacts[chat.id];
  const icon = { group: null, broadcast: 'broadcast', channel: 'channel', community: 'community' }[chat.type];
  return <Avatar id={chat.id} name={chatName(chat, contacts)} src={chat.type === 'direct' ? c?.avatar : chat.avatar} size={size} icon={!chat.avatar && icon} online={chat.type === 'direct' && getState().presence[chat.id]?.online && Date.now() - getState().presence[chat.id].lastSeen < 120000} />;
}

function Ticks({ status }) {
  if (status === 'pending') return <Icon name="clock" size={14} />;
  if (status === 'sent') return <Icon name="check" size={15} />;
  if (status === 'delivered') return <Icon name="check2" size={16} />;
  if (status === 'read') return <span class="read"><Icon name="check2" size={16} stroke={2.4} /></span>;
  return null;
}

export function ChatItem({ chat, onClick }) {
  const contacts = useStore((s) => s.contacts);
  const me = useStore((s) => s.me.id);
  const typing = useStore((s) => s.typing[chat.id]);
  const isTyping = typing && typing.until > Date.now();
  const unread = chat.unread > 0 || chat.markedUnread;
  const name = chatName(chat, contacts);
  return (
    <div class={'citem' + (chat.type === 'ai' ? ' ai' : '') + (unread ? ' unread' : '')} onClick={onClick || (() => openChat(chat.id))} onContextMenu={(e) => (e.preventDefault(), chatMenu(chat))}>
      {chatAvatar(chat, contacts)}
      <div class="row-b">
        <div class="row-t">
          <span>{name}</span>
          {chat.type === 'direct' && contacts[chat.id]?.postcode && <PostcodeChip code={contacts[chat.id].postcode.slice(0, 5)} />}
        </div>
        <div class="row-s">
          {isTyping ? (
            <span style={{ color: 'var(--v)', fontWeight: 600 }}>typing…</span>
          ) : (
            <>
              {chat.lastFrom === me && chat.type !== 'ai' && <Ticks status={chat.lastStatus} />}
              {chat.locked ? '🔒 Locked chat' : chat.lastFrom && chat.lastFrom !== me && ['group', 'community'].includes(chat.type) ? core.displayName(chat.lastFrom).split(' ')[0] + ': ' + (chat.lastPreview || '') : chat.lastPreview}
            </>
          )}
        </div>
      </div>
      <div class="row-r">
        <time>{chat.type === 'ai' ? '' : timeShort(chat.lastTs)}</time>
        <div style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
          {chat.muted && <Icon name="belloff" size={14} />}
          {chat.pinned && chat.type !== 'ai' && <Icon name="pin" size={14} />}
          {unread && <span class={'badge' + (chat.muted ? ' muted-b' : '')}>{chat.unread || ''}</span>}
        </div>
      </div>
    </div>
  );
}

export function openChat(id) {
  if (id === core.AI_CHAT) go('ai');
  else go('chat', { id });
}

export function chatMenu(chat) {
  const p = (patch) => core.patchChat(chat.id, patch);
  sheet(
    <Menu
      title={chat.name}
      items={[
        chat.type !== 'ai' && { icon: 'pin', label: chat.pinned ? 'Unpin' : 'Pin chat', onClick: () => (!chat.pinned && Object.values(getState().chats).filter((c) => c.pinned && c.type !== 'ai').length >= 3 ? toast('You can only pin 3 chats') : p({ pinned: !chat.pinned })) },
        { icon: 'archive', label: chat.archived ? 'Unarchive' : 'Archive chat', onClick: () => p({ archived: !chat.archived }) },
        { icon: chat.muted ? 'bell' : 'belloff', label: chat.muted ? 'Unmute' : 'Mute notifications', onClick: () => p({ muted: !chat.muted }) },
        { icon: 'chat', label: chat.unread || chat.markedUnread ? 'Mark as read' : 'Mark as unread', onClick: () => p(chat.unread || chat.markedUnread ? { unread: 0, markedUnread: false } : { markedUnread: true }) },
        { icon: 'star', label: chat.favourite ? 'Remove from favourites' : 'Add to favourites', onClick: () => p({ favourite: !chat.favourite }) },
        chat.type !== 'ai' && { icon: 'trash', label: 'Delete chat', danger: true, onClick: () => confirm('Delete this chat and its messages from this device?') && core.deleteChat(chat.id) },
      ]}
    />,
  );
}

const FILTERS = [
  ['all', 'All'],
  ['unread', 'Unread'],
  ['fav', 'Favourites'],
  ['groups', 'Groups'],
  ['channels', 'Channels'],
];

export function sortChats(list) {
  return list.sort((a, b) => (b.type === 'ai') - (a.type === 'ai') || (b.pinned ? 1 : 0) - (a.pinned ? 1 : 0) || (b.lastTs || 0) - (a.lastTs || 0));
}

export function ChatList() {
  const chats = useStore((s) => s.chats);
  const contacts = useStore((s) => s.contacts);
  const [q, setQ] = useState('');
  const [f, setF] = useState('all');
  const archivedCount = Object.values(chats).filter((c) => c.archived).length;
  const list = useMemo(() => {
    const ql = q.toLowerCase();
    return sortChats(
      Object.values(chats).filter((c) => {
        if (c.archived || c.type === 'community') return false;
        if (ql && !chatName(c, contacts).toLowerCase().includes(ql) && !(c.lastPreview || '').toLowerCase().includes(ql)) return false;
        if (f === 'unread') return c.unread > 0 || c.markedUnread;
        if (f === 'fav') return c.favourite;
        if (f === 'groups') return c.type === 'group';
        if (f === 'channels') return c.type === 'channel';
        return true;
      }),
    );
  }, [chats, contacts, q, f]);

  return (
    <div class="screen">
      <header class="hdr">
        <div class="brand">
          <Logo size={30} />
          <b>2qo</b>
        </div>
        <div class="spacer" />
        <NetPill />
        <IconBtn name="qr" label="Connect & share" onClick={() => go('connect')} />
        <IconBtn
          name="more"
          label="Menu"
          onClick={() =>
            sheet(
              <Menu
                items={[
                  { icon: 'users', label: 'New group', onClick: () => go('newgroup') },
                  { icon: 'broadcast', label: 'New broadcast list', onClick: () => go('newgroup', { type: 'broadcast' }) },
                  { icon: 'community', label: 'Communities', onClick: () => go('communities') },
                  { icon: 'channel', label: 'Channels', onClick: () => go('channels') },
                  { icon: 'star', label: 'Starred messages', onClick: () => go('starred') },
                  { icon: 'search', label: 'Search all messages', onClick: () => go('search') },
                  { icon: 'location', label: 'Postcode tools', onClick: () => go('postcode') },
                  { icon: 'link', label: 'Connections & devices', onClick: () => go('connect') },
                  { icon: 'siren', label: 'SOS & emergency', onClick: () => go('sos') },
                  { icon: 'settings', label: 'Settings', onClick: () => go('settings') },
                ]}
              />,
            )
          }
        />
      </header>
      <div class="search">
        <Icon name="search" size={18} />
        <input placeholder="Search chats or ask 2qo AI…" value={q} onInput={(e) => setQ(e.target.value)} />
      </div>
      <div class="chips">
        {FILTERS.map(([k, l]) => (
          <button class={'chip' + (f === k ? ' on' : '')} onClick={() => setF(k)}>
            {l}
          </button>
        ))}
      </div>
      <div class="scroll with-dock">
        {archivedCount > 0 && (
          <div class="citem" onClick={() => go('archived')}>
            <div class="row-ic" style={{ width: 50, height: 50, borderRadius: 17 }}>
              <Icon name="archive" />
            </div>
            <div class="row-b">
              <div class="row-t">Archived</div>
            </div>
            <div class="row-r">{archivedCount}</div>
          </div>
        )}
        <div class="clist">
          {list.map((c) => (
            <ChatItem chat={c} key={c.id} />
          ))}
        </div>
        {list.length <= 2 && !q && f === 'all' && (
          <Empty icon="users" title="Start chatting">
            Tap <b>+</b> to add people by QR code, or open <b>Nearby</b> to find 2qo users around your postcode. Testing on one device? Open this app in another tab with <code>?as=bayo</code>.
          </Empty>
        )}
        {q && (
          <button class="btn ghost" style={{ margin: '10px 16px' }} onClick={() => (go('ai'), import('../lib/ai/agent.js').then((a) => a.ask(q)))}>
            <Icon name="sparkle" size={18} /> Ask 2qo AI: “{q}”
          </button>
        )}
      </div>
      <button class="fab sos" onClick={() => go('sos')} aria-label="SOS">
        <Icon name="siren" />
      </button>
      <button class="fab" onClick={() => go('newchat')} aria-label="New chat">
        <Icon name="plus" size={26} stroke={2.4} />
      </button>
    </div>
  );
}

export function Archived() {
  const chats = useStore((s) => s.chats);
  const list = sortChats(Object.values(chats).filter((c) => c.archived));
  return (
    <div class="screen">
      <Header title="Archived" />
      <div class="scroll">
        <p class="muted small center" style={{ padding: '0 24px' }}>Archived chats stay archived when new messages arrive. Long-press to unarchive.</p>
        <div class="clist">{list.map((c) => <ChatItem chat={c} key={c.id} />)}</div>
        {!list.length && <Empty icon="archive" title="No archived chats" />}
      </div>
    </div>
  );
}

function MsgResult({ m }) {
  const chats = useStore((s) => s.chats);
  const chat = chats[m.chatId];
  return (
    <div class="row tap" onClick={() => go('chat', { id: m.chatId, focus: m.id })}>
      <div class="row-b">
        <div class="row-t">
          {core.displayName(m.from)} {chat && chat.type !== 'direct' ? <span class="muted">› {chat.name}</span> : null}
        </div>
        <div class="row-s">{core.preview(m)}</div>
      </div>
      <div class="row-r">{timeShort(m.ts)}</div>
    </div>
  );
}

export function Starred() {
  const [list, set] = useState(null);
  useEffect(() => void core.starredMessages().then(set), []);
  return (
    <div class="screen">
      <Header title="Starred messages" />
      <div class="scroll">
        {list && !list.length && <Empty icon="star" title="No starred messages">Long-press a message and tap ⭐ to keep it here.</Empty>}
        <div class="card" style={{ margin: 16 }}>{list?.map((m) => <MsgResult m={m} key={m.id} />)}</div>
      </div>
    </div>
  );
}

export function GlobalSearch() {
  const [q, setQ] = useState('');
  const [res, set] = useState([]);
  useEffect(() => {
    if (q.length < 2) return set([]);
    const t = setTimeout(() => core.searchMessages(q).then(set), 200);
    return () => clearTimeout(t);
  }, [q]);
  return (
    <div class="screen">
      <Header title="Search messages" />
      <div class="search">
        <Icon name="search" size={18} />
        <input autoFocus placeholder="Search text in all chats" value={q} onInput={(e) => setQ(e.target.value)} />
      </div>
      <div class="scroll">
        <div class="card" style={{ margin: 16 }}>{res.map((m) => <MsgResult m={m} key={m.id} />)}</div>
        {q.length > 1 && !res.length && <Empty icon="search" title="No matches" />}
      </div>
    </div>
  );
}
