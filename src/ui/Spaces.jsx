import { useState } from 'preact/hooks';
import { useStore, go, toast, sheet, getState } from '../lib/store.js';
import * as core from '../lib/core.js';
import { Header, Icon, Row, Section, Field, Empty, Avatar } from './kit.jsx';
import { ChatItem, chatAvatar } from './Chats.jsx';

function CreateForm({ kind, onDone }) {
  const [name, setName] = useState('');
  const [desc, setDesc] = useState('');
  const [members, setMembers] = useState([]);
  const contacts = Object.values(getState().contacts).filter((c) => c.saved);
  return (
    <Section title={kind === 'channel' ? 'New channel' : 'New community'}>
      <div class="pad">
        <Field label="Name"><input class="inp" value={name} onInput={(e) => setName(e.target.value)} autoFocus /></Field>
        <Field label="Description"><textarea class="inp" value={desc} onInput={(e) => setDesc(e.target.value)} /></Field>
        {kind === 'community' && (
          <>
            <div class="muted small" style={{ marginBottom: 6 }}>Members</div>
            <div class="sel-chips" style={{ padding: 0 }}>
              {contacts.map((c) => (
                <span style={{ cursor: 'pointer', outline: members.includes(c.id) ? '2px solid var(--v)' : 'none' }} onClick={() => setMembers((m) => (m.includes(c.id) ? m.filter((x) => x !== c.id) : [...m, c.id]))}>
                  <Avatar id={c.id} name={c.name} size={24} /> {c.name}
                </span>
              ))}
            </div>
          </>
        )}
        <button class="btn block" style={{ marginTop: 12 }} disabled={!name.trim()} onClick={async () => {
          const chat = kind === 'channel' ? await core.createChannel({ name: name.trim(), description: desc }) : await core.createCommunity({ name: name.trim(), description: desc, members });
          onDone(chat);
        }}>Create</button>
      </div>
    </Section>
  );
}

export function Channels({ create }) {
  const chats = useStore((s) => s.chats);
  const me = useStore((s) => s.me.id);
  const [creating, setCreating] = useState(!!create);
  const list = Object.values(chats).filter((c) => c.type === 'channel').sort((a, b) => (b.lastTs || 0) - (a.lastTs || 0));
  const mine = list.filter((c) => c.owner === me);
  const following = list.filter((c) => c.owner !== me);
  return (
    <div class="screen">
      <Header title="Channels" sub="One-way broadcasts to followers" actions={<button class="ibtn" onClick={() => setCreating(!creating)} aria-label="New channel"><Icon name="plus" /></button>} />
      <div class="scroll">
        {creating && <CreateForm kind="channel" onDone={(c) => (setCreating(false), go('chat', { id: c.id }))} />}
        <Section title="Your channels">
          {mine.map((c) => <ChatItem chat={c} key={c.id} />)}
          {!mine.length && <Row icon="plus" title="Create a channel" sub="Share news with your street, market, church or school" onClick={() => setCreating(true)} />}
        </Section>
        <Section title="Following">
          {following.map((c) => <ChatItem chat={c} key={c.id} />)}
          {!following.length && <Row icon="qr" title="Follow a channel" sub="Scan a channel’s QR code" onClick={() => go('connect', { tab: 'scan' })} />}
        </Section>
      </div>
    </div>
  );
}

export function Communities({ create }) {
  const chats = useStore((s) => s.chats);
  const contacts = useStore((s) => s.contacts);
  const [creating, setCreating] = useState(!!create);
  const list = Object.values(chats).filter((c) => c.type === 'community');
  return (
    <div class="screen">
      <Header title="Communities" sub="Groups of groups, with announcements" actions={<button class="ibtn" onClick={() => setCreating(!creating)} aria-label="New community"><Icon name="plus" /></button>} />
      <div class="scroll">
        {creating && <CreateForm kind="community" onDone={(c) => (setCreating(false), go('community', { id: c.id }))} />}
        {list.length ? (
          <Section>
            {list.map((c) => <Row avatar={chatAvatar(c, contacts, 46)} title={c.name} sub={`${(c.groups || []).length} groups · ${(c.members || []).length} members`} onClick={() => go('community', { id: c.id })} />)}
          </Section>
        ) : (
          !creating && <Empty icon="community" title="Bring your groups together">Create a community for your estate, association or school — with an announcements group everyone sees.</Empty>
        )}
      </div>
    </div>
  );
}

export function Community({ id }) {
  const chat = useStore((s) => s.chats[id]);
  const chats = useStore((s) => s.chats);
  if (!chat) return <div class="screen"><Header title="Not found" /></div>;
  const groups = (chat.groups || []).map((g) => chats[g]).filter(Boolean);
  const mine = Object.values(chats).filter((c) => c.type === 'group' && !c.communityId && (c.admins || []).includes(getState().me.id));
  return (
    <div class="screen">
      <Header title={chat.name} sub={chat.description} onTitle={() => go('chatinfo', { id })} />
      <div class="scroll">
        <Section title="Groups">{groups.map((g) => <ChatItem chat={g} key={g.id} />)}</Section>
        <Section>
          <Row icon="plus" title="New group in community" onClick={async () => {
            const name = prompt('Group name');
            if (!name) return;
            const g = await core.createGroup({ name, members: (chat.members || []).filter((m) => m !== getState().me.id), communityId: id });
            await core.patchChat(id, { groups: [...(chat.groups || []), g.id] });
          }} />
          {mine.length > 0 && <Row icon="link" title="Add an existing group" onClick={() => sheet(
            <div class="menu">{mine.map((g) => <button class="menu-i" onClick={async () => { await core.patchChat(g.id, { communityId: id }); await core.patchChat(id, { groups: [...(chat.groups || []), g.id] }); toast('Added'); getState().sheet && import('../lib/store.js').then((m) => m.setState({ sheet: null })); }}><Icon name="users" size={20} /><span>{g.name}</span></button>)}</div>,
          )} />}
          <Row icon="info" title="Community info" onClick={() => go('chatinfo', { id })} />
        </Section>
      </div>
    </div>
  );
}
