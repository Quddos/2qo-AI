import { useEffect, useState } from 'preact/hooks';
import { useStore, go, back, sheet, toast, getState, setState } from '../lib/store.js';
import * as core from '../lib/core.js';
import { Avatar, Header, Icon, Row, Section, Toggle, Menu, useBlobUrl, PostcodeChip, lastSeen, Field } from './kit.jsx';
import { chatAvatar } from './Chats.jsx';
import { disappearingSheet, wallpaperSheet } from './Chat.jsx';
import { startCall } from '../lib/calls.js';
import { safetyNumber } from '../lib/crypto.js';
import { smallAvatar } from '../lib/media.js';
import { display as pcDisplay, proximity, PROXIMITY_LABEL } from '../lib/postcode/format.js';
import { QR } from './Connect.jsx';

function Thumb({ m }) {
  const u = useBlobUrl(m.media.blobId);
  if (!u) return <div />;
  if (m.kind === 'image') return <div><img src={u} alt="" /></div>;
  if (m.kind === 'video') return <div><video src={u} muted /></div>;
  return <div class="muted small" style={{ padding: 6, textAlign: 'center' }}><Icon name={m.kind === 'audio' ? 'mic' : 'file'} /></div>;
}

function MediaStrip({ chatId }) {
  const [media, set] = useState([]);
  useEffect(() => void core.mediaFor(chatId).then(set), [chatId]);
  if (!media.length) return null;
  return (
    <section class="sect">
      <h4>Media, docs & voice ({media.length})</h4>
      <div class="gallery">{media.slice(0, 9).map((m) => <Thumb m={m} key={m.id} />)}</div>
    </section>
  );
}

function ChatToggles({ chat }) {
  const hasPin = useStore((s) => !!s.settings.pin);
  return (
    <Section>
      <Row icon="belloff" title="Mute notifications" right={<Toggle checked={!!chat.muted} onChange={(v) => core.patchChat(chat.id, { muted: v })} />} />
      {['direct', 'group'].includes(chat.type) && <Row icon="timer" title="Disappearing messages" sub={chat.disappearing ? core.humanDuration(chat.disappearing) : 'Off'} onClick={() => disappearingSheet(chat)} />}
      <Row icon="lock" title="Lock chat" sub={hasPin ? 'Requires your PIN to open' : 'Set a PIN in Settings › Privacy first'} right={<Toggle checked={!!chat.locked} onChange={(v) => (hasPin ? core.patchChat(chat.id, { locked: v }) : toast('Set a PIN in Settings › Privacy first'))} />} />
      <Row icon="image" title="Wallpaper" onClick={() => wallpaperSheet(chat)} />
      <Row icon="star" title="Favourite" right={<Toggle checked={!!chat.favourite} onChange={(v) => core.patchChat(chat.id, { favourite: v })} />} />
    </Section>
  );
}

export function ContactInfo({ id }) {
  return <ChatInfo id={id} />;
}

export function ChatInfo({ id }) {
  const chat = useStore((s) => s.chats[id]);
  const contact = useStore((s) => s.contacts[id]);
  const me = useStore((s) => s.me);
  const contacts = useStore((s) => s.contacts);
  const presence = useStore((s) => s.presence[id]);
  const [safety, setSafety] = useState('');
  useEffect(() => {
    if (contact?.publicJwk) safetyNumber(me.publicJwk, contact.publicJwk).then(setSafety);
  }, [contact?.publicJwk]);

  if (!chat && contact) {
    // contact without chat yet
    return (
      <div class="screen">
        <Header title="Contact" />
        <div class="scroll pad center">
          <Avatar id={contact.id} name={contact.name} src={contact.avatar} size={110} />
          <h2>{contact.name}</h2>
          <button class="btn" onClick={async () => (await core.openDirect(id), go('chat', { id }))}>Message</button>
        </div>
      </div>
    );
  }
  if (!chat) return <div class="screen"><Header title="Not found" /></div>;

  if (chat.type === 'direct' || chat.type === 'self') {
    const c = contact || (chat.type === 'self' ? { ...me, name: 'You' } : {});
    const prox = c.postcode && me.postcode ? proximity(me.postcode, c.postcode) : -1;
    return (
      <div class="screen">
        <Header title="" />
        <div class="scroll">
          <div class="center pad">
            <Avatar id={id} name={c.alias || c.name} src={c.avatar} size={110} />
            <h2 style={{ margin: '12px 0 4px' }}>{c.alias || c.name}</h2>
            {c.alias && <div class="muted small">~{c.name}</div>}
            <div class="muted">{lastSeen(presence)}</div>
            {c.postcode && (
              <div style={{ marginTop: 8, display: 'flex', gap: 6, justifyContent: 'center', alignItems: 'center' }}>
                <PostcodeChip code={c.postcode} onClick={() => go('postcode', { code: c.postcode })} />
                {prox >= 0 && chat.type !== 'self' && <span class="muted small">{PROXIMITY_LABEL[prox]}</span>}
              </div>
            )}
            {chat.type === 'direct' && (
              <div class="btns" style={{ justifyContent: 'center', marginTop: 16 }}>
                <button class="btn ghost" onClick={() => go('chat', { id })}><Icon name="chat" size={18} /> Message</button>
                <button class="btn ghost" onClick={() => startCall(id, false)}><Icon name="phone" size={18} /> Call</button>
                <button class="btn ghost" onClick={() => startCall(id, true)}><Icon name="video" size={18} /> Video</button>
              </div>
            )}
          </div>
          {c.about && (
            <Section title="About">
              <Row title={c.about} />
            </Section>
          )}
          <MediaStrip chatId={id} />
          <ChatToggles chat={chat} />
          {chat.type === 'direct' && (
            <>
              <Section title="Encryption">
                <Row icon="shield" title="Safety number" sub={safety || '…'} />
                <Row icon="key" title="Verify in person" sub="Compare this number on both phones. If it matches, the chat is end-to-end secure." />
              </Section>
              <Section>
                {contact?.isOrg && (
                  <Row icon="shield" title={`Trust as emergency service (${contact.orgType})`} sub="Only trusted services receive your SOS recordings & location" right={<Toggle checked={!!contact.orgTrusted} onChange={(v) => core.saveContact({ ...contact, orgTrusted: v })} />} />
                )}
                {!contact?.saved && <Row icon="user" title="Save contact" onClick={() => core.saveContact({ ...contact, saved: true }).then(() => toast('Saved'))} />}
                <Row icon="edit" title="Set nickname" sub={contact?.alias || 'Not set'} onClick={() => { const a = prompt('Nickname for ' + contact.name, contact.alias || ''); if (a !== null) core.saveContact({ ...contact, alias: a.trim() || null }); }} />
                <Row icon="shield" title={contact?.blocked ? 'Unblock' : 'Block'} danger={!contact?.blocked} onClick={() => core.saveContact({ ...contact, blocked: !contact.blocked }).then(() => toast(contact.blocked ? 'Unblocked' : 'Blocked — you won’t receive their messages or calls'))} />
                <Row icon="trash" title="Delete chat" danger onClick={() => confirm('Delete this chat?') && core.deleteChat(id).then(() => go('chats'))} />
              </Section>
            </>
          )}
        </div>
      </div>
    );
  }

  // group / broadcast / channel / community
  const isAdmin = (chat.admins || []).includes(me.id) || chat.owner === me.id;
  const members = chat.type === 'channel' ? chat.followers || [] : chat.members || [];
  async function editAvatar(e) {
    const f = e.target.files[0];
    if (f) await core.updateGroup(id, { avatar: await smallAvatar(f) }, `${me.name} changed the group photo`);
  }
  return (
    <div class="screen">
      <Header title="" />
      <div class="scroll">
        <div class="center pad">
          <label style={{ cursor: isAdmin ? 'pointer' : 'default', display: 'inline-block' }}>
            {chatAvatar(chat, contacts, 110)}
            {isAdmin && <input type="file" accept="image/*" hidden onChange={editAvatar} />}
          </label>
          <h2 style={{ margin: '12px 0 4px' }}>{chat.name}</h2>
          <div class="muted">
            {{ group: 'Group', broadcast: 'Broadcast list', channel: 'Channel', community: 'Community' }[chat.type]} · {members.length} {chat.type === 'channel' ? 'followers' : 'members'}
          </div>
          {chat.description && <p>{chat.description}</p>}
        </div>
        {isAdmin && chat.type !== 'broadcast' && (
          <Section>
            <Row icon="edit" title="Edit name & description" onClick={() => editGroupSheet(chat)} />
            {chat.type === 'group' && <Row icon="lock" title="Only admins can send" right={<Toggle checked={!!chat.onlyAdmins} onChange={(v) => core.updateGroup(id, { onlyAdmins: v }, v ? 'Only admins can send messages now' : 'All members can send messages')} />} />}
          </Section>
        )}
        {chat.type === 'channel' && (
          <Section title="Share channel">
            <div class="center pad">
              <QR text={JSON.stringify(core.channelInvite(chat))} />
              <p class="muted small">Others scan this in Connect › Scan, or you can send the invite into a chat.</p>
            </div>
          </Section>
        )}
        <MediaStrip chatId={id} />
        {chat.type !== 'community' && <ChatToggles chat={chat} />}
        <Section title={chat.type === 'channel' ? 'Followers' : 'Members'}>
          {isAdmin && chat.type !== 'channel' && <Row icon="plus" title="Add members" onClick={() => addMembersSheet(chat)} />}
          {members.map((m) => (
            <Row
              avatar={<Avatar id={m} name={core.displayName(m)} src={m === me.id ? me.avatar : contacts[m]?.avatar} size={40} />}
              title={core.displayName(m)}
              sub={contacts[m]?.postcode ? pcDisplay(contacts[m].postcode) : contacts[m]?.about}
              right={(chat.admins || []).includes(m) ? <span class="pc-chip">admin</span> : null}
              onClick={m === me.id ? null : () => memberMenu(chat, m, isAdmin)}
            />
          ))}
        </Section>
        <Section>
          {chat.type === 'group' && !chat.left && <Row icon="back" title="Exit group" danger onClick={() => confirm('Leave this group?') && core.leaveGroup(id)} />}
          {chat.type === 'channel' && chat.owner !== me.id && <Row icon="back" title="Unfollow channel" danger onClick={() => core.unfollowChannel(id).then(() => go('chats'))} />}
          <Row icon="trash" title={chat.type === 'broadcast' ? 'Delete broadcast list' : 'Delete chat'} danger onClick={() => confirm('Delete from this device?') && core.deleteChat(id).then(() => go('chats'))} />
        </Section>
      </div>
    </div>
  );
}

function memberMenu(chat, m, isAdmin) {
  const admins = chat.admins || [];
  sheet(
    <Menu
      title={core.displayName(m)}
      items={[
        { icon: 'chat', label: 'Message', onClick: async () => (await core.openDirect(m), go('chat', { id: m })) },
        { icon: 'info', label: 'View contact', onClick: () => go('chatinfo', { id: m }) },
        isAdmin && chat.type === 'group' && { icon: 'shield', label: admins.includes(m) ? 'Dismiss as admin' : 'Make group admin', onClick: () => core.updateGroup(chat.id, { admins: admins.includes(m) ? admins.filter((x) => x !== m) : [...admins, m] }, `${core.displayName(m)} is ${admins.includes(m) ? 'no longer' : 'now'} an admin`) },
        isAdmin && chat.type !== 'channel' && { icon: 'trash', label: 'Remove', danger: true, onClick: () => core.updateGroup(chat.id, { members: chat.members.filter((x) => x !== m), admins: admins.filter((x) => x !== m) }, `${core.displayName(m)} was removed`).then(() => core.send(m, { k: 'group', group: { ...chat, members: chat.members.filter((x) => x !== m) }, note: 'You were removed' })) },
      ]}
    />,
  );
}

function addMembersSheet(chat) {
  const list = Object.values(getState().contacts).filter((c) => c.saved && !(chat.members || []).includes(c.id));
  if (!list.length) return toast('All your saved contacts are already in');
  sheet(<Menu title="Add member" items={list.map((c) => ({ icon: 'user', label: c.name, onClick: () => core.updateGroup(chat.id, { members: [...chat.members, c.id] }, `${getState().me.name} added ${c.name}`) }))} />);
}

function editGroupSheet(chat) {
  function F() {
    const [name, setName] = useState(chat.name);
    const [desc, setDesc] = useState(chat.description || '');
    return (
      <div class="pad">
        <Field label="Name"><input class="inp" value={name} onInput={(e) => setName(e.target.value)} /></Field>
        <Field label="Description"><textarea class="inp" value={desc} onInput={(e) => setDesc(e.target.value)} /></Field>
        <button class="btn block" onClick={() => { setState({ sheet: null }); core.updateGroup(chat.id, { name: name.trim() || chat.name, description: desc }, name !== chat.name ? `Name changed to “${name}”` : 'Description updated'); }}>Save</button>
      </div>
    );
  }
  sheet(<F />);
}
