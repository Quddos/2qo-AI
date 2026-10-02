// 2qo messaging engine: identity, contacts, chats, messages, receipts,
// groups, broadcast lists, communities, channels, status, outbox & transports.
import * as DB from './db.js';
import { getState, setState, toast } from './store.js';
import { loadOrCreateKeys, fingerprint, seal, open, uid } from './crypto.js';
import { createBus } from './net/bus.js';
import { createHub, defaultHubUrl } from './net/hub.js';
import { createP2P } from './net/p2p.js';
import { notify } from './notify.js';

export const AI_CHAT = 'ai';
const DAY = 86400000;
const NO_RCPT = new Set(['typing', 'rcpt', 'call-ice', 'presence']);

export const DEFAULT_SETTINGS = {
  theme: 'auto',
  accent: 'sun',
  fontSize: 16,
  wallpaper: 'grid',
  readReceipts: true,
  lastSeen: 'everyone',
  statusPrivacy: 'contacts',
  enterToSend: true,
  notifications: true,
  hubUrl: '',
  autoHub: true,
  aiEngine: 'auto',
  wakeWord: false,
  voiceReplies: true,
  language: 'en-NG',
  postcodeApi: 'https://api.postcode.gov.ng',
  postcodeKey: '',
  emergencyNumber: '112',
  emergencyContacts: [],
  sosRecordSeconds: 30,
  sosCountdown: 5,
  sosMode: 'video',
};

let keys;
let bus, hub, p2p;
const seen = new Set();
const blobUrls = new Map();

// ---------------------------------------------------------------- bootstrap --
export async function init() {
  const [me, settings, contacts, chats, statuses, calls] = await Promise.all([
    DB.kv.get('me'),
    DB.kv.get('settings'),
    DB.all('contacts'),
    DB.all('chats'),
    DB.all('status'),
    DB.all('calls'),
  ]);
  keys = await loadOrCreateKeys();
  const s = { ...DEFAULT_SETTINGS, ...(settings || {}) };
  setState({
    me: me || null,
    settings: s,
    contacts: Object.fromEntries(contacts.map((c) => [c.id, c])),
    chats: Object.fromEntries(chats.map((c) => [c.id, c])),
    statuses: statuses.filter((x) => x.expiresAt > Date.now()),
    calls: calls.sort((a, b) => b.ts - a.ts),
    ready: true,
  });
  if (me) await startNetwork();
  setInterval(sweep, 30000);
  sweep();
  addEventListener('online', () => {
    setState((st) => ({ net: { ...st.net, online: true } }));
    hub?.reconnect();
    if (!hubDetected) detectHub();
    flushOutbox();
  });
  addEventListener('offline', () => setState((st) => ({ net: { ...st.net, online: false } })));
}

export async function createProfile({ name, about = '', postcode = '', avatar = null, lat = null, lng = null }) {
  const id = await fingerprint(keys.publicJwk);
  const me = { id, name: name.trim(), about, postcode, avatar, lat, lng, publicJwk: keys.publicJwk, createdAt: Date.now() };
  await DB.kv.set('me', me);
  setState({ me });
  await ensureAIChat();
  await ensureSelfChat();
  await startNetwork();
  return me;
}

export async function updateProfile(patch) {
  const me = { ...getState().me, ...patch };
  await DB.kv.set('me', me);
  setState({ me });
  const pub = publicProfile();
  bus?.announce(pub);
  hub?.announce(pub);
  p2p?.announce(pub);
}

export async function updateSettings(patch) {
  const settings = { ...getState().settings, ...patch };
  await DB.kv.set('settings', settings);
  setState({ settings });
  if ('hubUrl' in patch || 'autoHub' in patch) {
    hub?.setUrl(hubUrl());
    if (patch.autoHub) detectHub();
  }
}

let hubDetected = false;
function hubUrl() {
  const s = getState().settings;
  return s.hubUrl || (s.autoHub && hubDetected ? defaultHubUrl() : null);
}

/** Is the origin that served this app a 2qo Hub? (avoids pointless socket retries elsewhere) */
async function detectHub() {
  try {
    const r = await fetch('/api/hub', { cache: 'no-store' });
    hubDetected = r.ok && (await r.json()).app === '2qo-hub';
  } catch {
    hubDetected = false;
  }
  if (hubDetected && !getState().settings.hubUrl) hub?.setUrl(hubUrl());
}

export function publicProfile() {
  const { id, name, about, postcode, avatar, publicJwk, lat, lng } = getState().me;
  const s = getState().settings;
  return {
    id,
    name,
    about,
    postcode,
    publicJwk,
    // people share a coarse location (≈1 km) for "near me"; service accounts share their exact spot
    lat: lat != null ? (getState().me.isOrg ? lat : Math.round(lat * 100) / 100) : null,
    lng: lng != null ? (getState().me.isOrg ? lng : Math.round(lng * 100) / 100) : null,
    avatar: avatar && avatar.length < 60000 ? avatar : null,
    lastSeen: s.lastSeen === 'nobody' ? null : Date.now(),
    isOrg: getState().me.isOrg || null,
    orgType: getState().me.orgType || null,
  };
}

async function startNetwork() {
  const pub = publicProfile();
  const handlers = { onEnvelope, onAnnounce };
  bus = createBus(handlers);
  bus?.start(pub);
  hub = createHub({
    ...handlers,
    onStatus: (h) => {
      setState((st) => ({ net: { ...st.net, hub: h } }));
      if (h === 'connected') flushOutbox();
    },
    onPresence: (id, online, lastSeen) =>
      setState((st) => ({ presence: { ...st.presence, [id]: { online, lastSeen } } })),
  });
  hub.start(pub, hubUrl());
  detectHub();
  p2p = createP2P({
    ...handlers,
    onStatus: (peers) => {
      setState((st) => ({ net: { ...st.net, peers } }));
      flushOutbox();
    },
  });
  p2p.start(pub);
  setInterval(flushOutbox, 20000);
}

export const net = {
  get p2p() {
    return p2p;
  },
  get hub() {
    return hub;
  },
};

async function ensureAIChat() {
  if (getState().chats[AI_CHAT]) return;
  await saveChat({ id: AI_CHAT, type: 'ai', name: '2qo AI', pinned: true, lastTs: Date.now(), lastPreview: 'Say “Hey 2qo” or type a command' });
}
async function ensureSelfChat() {
  const me = getState().me;
  if (getState().chats[me.id]) return;
  await saveChat({ id: me.id, type: 'self', name: 'Notes to self', lastTs: Date.now() - 1, lastPreview: 'Message yourself' });
}

// ------------------------------------------------------------------ contacts --
async function onAnnounce(profile, via) {
  if (!profile?.id || !profile.publicJwk || profile.id === getState().me?.id) return;
  // a profile id must match its key, otherwise it's an impersonation attempt
  if ((await fingerprint(profile.publicJwk)) !== profile.id) return;
  const prev = getState().contacts[profile.id];
  const c = {
    ...(prev || { saved: false, addedAt: Date.now() }),
    ...profile,
    avatar: profile.avatar || prev?.avatar || null,
    via,
    seenAt: Date.now(),
  };
  await saveContact(c);
  setState((st) => ({ presence: { ...st.presence, [c.id]: { online: true, lastSeen: profile.lastSeen || Date.now() } } }));
  if (via === 'bus' || via === 'p2p') flushOutbox();
}

export async function saveContact(c) {
  await DB.put('contacts', c);
  setState((st) => ({ contacts: { ...st.contacts, [c.id]: c } }));
  return c;
}

export async function addContactFromCard(card) {
  if (!card?.id || !card.publicJwk) throw new Error('Invalid contact card');
  if ((await fingerprint(card.publicJwk)) !== card.id) throw new Error('Contact card failed verification');
  const prev = getState().contacts[card.id];
  return saveContact({ ...(prev || { addedAt: Date.now() }), ...card, saved: true });
}

export function contactCard() {
  const { id, name, postcode, publicJwk, about } = getState().me;
  return { t: '2qo-contact', id, name, postcode, about, publicJwk };
}

export function displayName(id) {
  const st = getState();
  if (id === st.me?.id) return 'You';
  const c = st.contacts[id];
  return c?.alias || c?.name || 'Unknown ' + String(id).slice(0, 4);
}

// --------------------------------------------------------------------- chats --
export async function saveChat(chat) {
  await DB.put('chats', chat);
  setState((st) => ({ chats: { ...st.chats, [chat.id]: chat } }));
  return chat;
}

export async function patchChat(id, patch) {
  const chat = getState().chats[id];
  if (!chat) return;
  return saveChat({ ...chat, ...patch });
}

export async function openDirect(contactId) {
  const st = getState();
  if (st.chats[contactId]) return st.chats[contactId];
  const c = st.contacts[contactId];
  return saveChat({ id: contactId, type: 'direct', name: c?.name || 'Contact', lastTs: Date.now(), unread: 0 });
}

export async function loadMessages(chatId) {
  const list = (await DB.messagesFor(chatId)).filter((m) => !m.hidden);
  setState((st) => ({ messages: { ...st.messages, [chatId]: list } }));
  return list;
}

async function storeMessage(msg, { bump = true, unread = false } = {}) {
  await DB.put('messages', msg);
  setState((st) => {
    const arr = st.messages[msg.chatId];
    if (!arr) return {};
    const i = arr.findIndex((m) => m.id === msg.id);
    const next = i >= 0 ? arr.map((m) => (m.id === msg.id ? msg : m)) : [...arr, msg].sort((a, b) => a.ts - b.ts);
    return { messages: { ...st.messages, [msg.chatId]: next } };
  });
  const chat = getState().chats[msg.chatId];
  if (!chat) return;
  if (bump) {
    await saveChat({
      ...chat,
      lastTs: msg.ts,
      lastPreview: preview(msg),
      lastFrom: msg.from,
      lastStatus: msg.status,
      unread: unread ? (chat.unread || 0) + 1 : chat.unread || 0,
    });
  } else if (msg.ts === chat.lastTs && (chat.lastStatus !== msg.status || chat.lastPreview !== preview(msg))) {
    await saveChat({ ...chat, lastStatus: msg.status, lastPreview: preview(msg) });
  }
}

export function preview(m) {
  if (m.deleted) return '🚫 Message deleted';
  const icon = { image: '📷 Photo', video: '🎥 Video', audio: '🎤 Voice note', file: '📄 ', location: '📍 Location', contact: '👤 Contact', poll: '📊 ', sos: '🚨 SOS alert', sticker: 'Sticker' }[m.kind];
  if (m.kind === 'text' || m.kind === 'system') return m.text;
  if (m.kind === 'sos') return '🚨 ' + String(m.text || 'SOS alert').split('\n')[0].replace(/^🚨\s*/, '');
  if (m.kind === 'file') return icon + (m.media?.name || 'Document');
  if (m.kind === 'poll') return icon + m.poll.question;
  return (icon || '') + (m.text ? ' ' + m.text : '');
}

export async function markRead(chatId) {
  const st = getState();
  const chat = st.chats[chatId];
  if (!chat) return;
  if (chat.unread || chat.markedUnread) await patchChat(chatId, { unread: 0, markedUnread: false });
  if (!st.settings.readReceipts) return;
  const msgs = st.messages[chatId] || [];
  const byFrom = {};
  for (const m of msgs) {
    if (m.from !== st.me.id && !m.readSent && m.kind !== 'system') {
      (byFrom[m.from] ||= []).push(m.id);
      m.readSent = true;
      DB.put('messages', m);
    }
  }
  for (const [from, ids] of Object.entries(byFrom)) {
    send(from, { k: 'ack', state: 'read', ids, chatId: chat.type === 'group' ? chatId : null });
  }
}

/**
 * Send a message to a chat. `draft` = { kind, text, media:{dataUrl|blob,mime,name,...}, replyTo, poll, location, contact }
 */
export async function sendMessage(chatId, draft) {
  const st = getState();
  const chat = st.chats[chatId];
  if (!chat) throw new Error('Unknown chat');
  if (chat.type === 'channel' && chat.owner !== st.me.id) throw new Error('Only the channel owner can post');
  if (chat.type === 'group' && chat.onlyAdmins && !(chat.admins || []).includes(st.me.id))
    throw new Error('Only admins can send messages in this group');

  // messaging someone directly adds them to your saved contacts (like saving a number)
  if (chat.type === 'direct' && st.contacts[chatId] && !st.contacts[chatId].saved) await saveContact({ ...st.contacts[chatId], saved: true });

  const id = uid(12);
  const ts = Date.now();
  let media = null;
  let mediaWire = null;
  if (draft.media) {
    const blob = draft.media.blob || (await (await fetch(draft.media.dataUrl)).blob());
    await DB.putBlob(id, blob);
    media = { blobId: id, mime: blob.type || draft.media.mime, name: draft.media.name, size: blob.size, duration: draft.media.duration, viewOnce: draft.media.viewOnce };
    mediaWire = { ...media, dataUrl: draft.media.dataUrl || (await DB.blobToDataURL(blob)) };
  }
  const msg = {
    id,
    chatId,
    from: st.me.id,
    ts,
    kind: draft.kind || 'text',
    text: draft.text || '',
    media,
    replyTo: draft.replyTo || null,
    forwarded: draft.forwarded || false,
    poll: draft.poll || null,
    location: draft.location || null,
    contact: draft.contact || null,
    sos: draft.sos || null,
    reactions: {},
    status: chat.type === 'self' || chat.type === 'ai' ? 'read' : 'pending',
    expiresAt: chat.disappearing ? ts + chat.disappearing * 1000 : null,
  };
  await storeMessage(msg);

  const wire = { ...msg, media: mediaWire, status: undefined };
  const targets = recipients(chat);
  const groupMeta = chat.type === 'group' || chat.type === 'channel' ? groupWire(chat) : null;
  let sent = false;
  for (const to of targets) {
    const payload = chat.type === 'broadcast' ? { k: 'msg', msg: { ...wire, chatId: null } } : { k: 'msg', msg: { ...wire, chatId: chat.type === 'direct' ? null : chatId }, group: groupMeta };
    sent = (await send(to, payload)) || sent;
  }
  if (targets.length) await setMsgStatus(chatId, id, sent ? 'sent' : 'pending');
  return msg;
}

function recipients(chat) {
  const me = getState().me.id;
  if (chat.type === 'direct') return [chat.id];
  if (chat.type === 'group' || chat.type === 'broadcast') return (chat.members || []).filter((m) => m !== me);
  if (chat.type === 'channel') return (chat.followers || []).filter((m) => m !== me);
  return [];
}

function groupWire(chat) {
  const { id, type, name, members, admins, description, avatar, onlyAdmins, owner, communityId, followers } = chat;
  return { id, type, name, members, admins, description, avatar: avatar && avatar.length < 60000 ? avatar : null, onlyAdmins, owner, communityId, followersCount: followers?.length };
}

async function setMsgStatus(chatId, id, status, extra = {}) {
  const m = (await DB.get('messages', id)) || null;
  if (!m) return;
  const order = ['pending', 'sent', 'delivered', 'read'];
  if (order.indexOf(status) < order.indexOf(m.status)) return;
  await storeMessage({ ...m, status, ...extra }, { bump: false });
}

export async function reactTo(chatId, msgId, emoji) {
  const st = getState();
  const m = await DB.get('messages', msgId);
  if (!m) return;
  const reactions = { ...m.reactions };
  if (reactions[st.me.id] === emoji || !emoji) delete reactions[st.me.id];
  else reactions[st.me.id] = emoji;
  await storeMessage({ ...m, reactions }, { bump: false });
  const chat = st.chats[chatId];
  for (const to of recipients(chat)) send(to, { k: 'react', chatId: chat.type === 'direct' ? null : chatId, msgId, emoji: reactions[st.me.id] || null });
}

export async function editMessage(chatId, msgId, text) {
  const m = await DB.get('messages', msgId);
  if (!m || m.from !== getState().me.id) return;
  if (Date.now() - m.ts > 15 * 60000) throw new Error('Messages can only be edited for 15 minutes');
  await storeMessage({ ...m, text, edited: Date.now() }, { bump: false });
  const chat = getState().chats[chatId];
  for (const to of recipients(chat)) send(to, { k: 'edit', chatId: chat.type === 'direct' ? null : chatId, msgId, text });
}

export async function deleteMessage(chatId, msgId, everyone) {
  const m = await DB.get('messages', msgId);
  if (!m) return;
  if (everyone) {
    if (m.from !== getState().me.id) throw new Error('You can only delete your own messages for everyone');
    await storeMessage({ ...m, deleted: true, text: '', media: null, poll: null }, { bump: false });
    const chat = getState().chats[chatId];
    for (const to of recipients(chat)) send(to, { k: 'revoke', chatId: chat.type === 'direct' ? null : chatId, msgId });
  } else {
    await DB.del('messages', msgId);
    setState((st) => ({ messages: { ...st.messages, [chatId]: (st.messages[chatId] || []).filter((x) => x.id !== msgId) } }));
  }
}

export async function toggleStar(msgId) {
  const m = await DB.get('messages', msgId);
  if (m) await storeMessage({ ...m, starred: !m.starred }, { bump: false });
}

export async function forwardMessage(msg, chatIds) {
  for (const cid of chatIds) {
    let media = null;
    if (msg.media) {
      const blob = await DB.getBlob(msg.media.blobId);
      if (blob) media = { blob, mime: msg.media.mime, name: msg.media.name, duration: msg.media.duration };
    }
    await sendMessage(cid, { kind: msg.kind, text: msg.text, media, poll: msg.poll && { ...msg.poll, options: msg.poll.options.map((o) => ({ text: o.text, votes: [] })) }, location: msg.location, contact: msg.contact, forwarded: true });
  }
}

export async function votePoll(chatId, msgId, optionIdxs) {
  const st = getState();
  const m = await DB.get('messages', msgId);
  if (!m?.poll) return;
  applyVote(m, st.me.id, optionIdxs);
  await storeMessage(m, { bump: false });
  const chat = st.chats[chatId];
  for (const to of recipients(chat)) send(to, { k: 'vote', chatId: chat.type === 'direct' ? null : chatId, msgId, options: optionIdxs });
}

function applyVote(m, voter, idxs) {
  m.poll = { ...m.poll, options: m.poll.options.map((o, i) => ({ ...o, votes: o.votes.filter((v) => v !== voter).concat(idxs.includes(i) ? [voter] : []) })) };
}

export async function clearChat(chatId) {
  const msgs = await DB.messagesFor(chatId);
  for (const m of msgs) if (!m.starred) await DB.del('messages', m.id);
  await loadMessages(chatId);
  await patchChat(chatId, { lastPreview: '', unread: 0 });
}

export async function deleteChat(chatId) {
  const msgs = await DB.messagesFor(chatId);
  for (const m of msgs) await DB.del('messages', m.id);
  await DB.del('chats', chatId);
  setState((st) => {
    const chats = { ...st.chats };
    delete chats[chatId];
    return { chats };
  });
}

export async function setDisappearing(chatId, seconds) {
  const chat = getState().chats[chatId];
  await patchChat(chatId, { disappearing: seconds || 0 });
  await systemMessage(chatId, seconds ? `Disappearing messages on: ${humanDuration(seconds)}` : 'Disappearing messages turned off');
  for (const to of recipients(chat)) send(to, { k: 'chat-setting', chatId: chat.type === 'direct' ? null : chatId, disappearing: seconds || 0 });
}

export function humanDuration(s) {
  if (s >= 86400 * 7) return `${Math.round(s / 86400 / 7)} week(s)`;
  if (s >= 86400) return `${Math.round(s / 86400)} day(s)`;
  if (s >= 3600) return `${Math.round(s / 3600)} hour(s)`;
  return `${Math.round(s / 60)} minute(s)`;
}

export async function systemMessage(chatId, text) {
  await storeMessage({ id: uid(12), chatId, from: 'system', ts: Date.now(), kind: 'system', text, reactions: {} });
}

export function sendTyping(chatId) {
  const chat = getState().chats[chatId];
  if (!chat || !['direct', 'group'].includes(chat.type)) return;
  for (const to of recipients(chat)) send(to, { k: 'typing', chatId: chat.type === 'direct' ? null : chatId });
}

// ----------------------------------------------- groups / lists / communities --
export async function createGroup({ name, members, description = '', avatar = null, type = 'group', communityId = null }) {
  const me = getState().me.id;
  const chat = {
    id: (type === 'broadcast' ? 'b:' : type === 'community' ? 'c:' : 'g:') + uid(8),
    type,
    name,
    description,
    avatar,
    members: [me, ...members.filter((m) => m !== me)],
    admins: [me],
    owner: me,
    communityId,
    createdAt: Date.now(),
    lastTs: Date.now(),
    unread: 0,
  };
  await saveChat(chat);
  if (type === 'group') {
    await systemMessage(chat.id, `You created “${name}”`);
    for (const to of recipients(chat)) send(to, { k: 'group', group: groupWire(chat), note: `${getState().me.name} added you` });
  } else if (type === 'broadcast') {
    await systemMessage(chat.id, `Broadcast list with ${members.length} recipient(s). Only contacts who saved you receive it.`);
  }
  return chat;
}

export async function createCommunity({ name, description, groupIds = [], members = [] }) {
  const community = await createGroup({ name, description, members, type: 'community' });
  const ann = await createGroup({ name: `${name} · Announcements`, members, communityId: community.id });
  await patchChat(ann.id, { onlyAdmins: true, announcement: true });
  for (const gid of groupIds) await patchChat(gid, { communityId: community.id });
  await patchChat(community.id, { groups: [ann.id, ...groupIds] });
  return community;
}

export async function updateGroup(chatId, patch, note) {
  const chat = await patchChat(chatId, patch);
  if (note) await systemMessage(chatId, note);
  const notify = new Set([...(chat.members || [])]);
  for (const to of notify) if (to !== getState().me.id) send(to, { k: 'group', group: groupWire(chat), note });
  return chat;
}

export async function leaveGroup(chatId) {
  const st = getState();
  const chat = st.chats[chatId];
  const members = (chat.members || []).filter((m) => m !== st.me.id);
  for (const to of members) send(to, { k: 'group-leave', chatId });
  await patchChat(chatId, { left: true, members });
  await systemMessage(chatId, 'You left');
}

// ------------------------------------------------------------------ channels --
export async function createChannel({ name, description, avatar }) {
  const me = getState().me.id;
  const chat = await saveChat({ id: 'ch:' + uid(8), type: 'channel', name, description, avatar, owner: me, admins: [me], members: [me], followers: [], createdAt: Date.now(), lastTs: Date.now(), unread: 0 });
  await systemMessage(chat.id, 'Channel created. Share it from Channel info so people can follow.');
  return chat;
}

export function channelInvite(chat) {
  return { t: '2qo-channel', id: chat.id, name: chat.name, description: chat.description, owner: chat.owner, ownerKey: getState().contacts[chat.owner]?.publicJwk || getState().me.publicJwk, ownerName: displayName(chat.owner) };
}

export async function followChannel(inv) {
  const st = getState();
  if (!st.contacts[inv.owner] && inv.ownerKey) await onAnnounce({ id: inv.owner, name: inv.ownerName, publicJwk: inv.ownerKey }, 'invite');
  await saveChat({ id: inv.id, type: 'channel', name: inv.name, description: inv.description, owner: inv.owner, followers: [], members: [inv.owner], lastTs: Date.now(), unread: 0, following: true });
  send(inv.owner, { k: 'follow', channelId: inv.id, on: true });
}

export async function unfollowChannel(chatId) {
  const chat = getState().chats[chatId];
  send(chat.owner, { k: 'follow', channelId: chatId, on: false });
  await deleteChat(chatId);
}

// -------------------------------------------------------------------- status --
export async function postStatus({ kind = 'text', text = '', bg = '#5b3df5', font = 0, media = null }) {
  const st = getState();
  const s = { id: uid(10), from: st.me.id, ts: Date.now(), expiresAt: Date.now() + DAY, kind, text, bg, font, media, views: {} };
  await DB.put('status', s);
  setState((x) => ({ statuses: [...x.statuses, s] }));
  const targets = Object.values(st.contacts).filter((c) => c.saved && !c.blocked && allowedStatus(c.id));
  for (const c of targets) send(c.id, { k: 'status', status: { ...s, views: undefined } });
  return s;
}

function allowedStatus(id) {
  const s = getState().settings;
  if (s.statusPrivacy === 'except') return !(s.statusExcept || []).includes(id);
  if (s.statusPrivacy === 'only') return (s.statusOnly || []).includes(id);
  return true;
}

export async function viewStatus(s) {
  const me = getState().me.id;
  if (s.from === me || s.viewed) return;
  const next = { ...s, viewed: true };
  await DB.put('status', next);
  setState((x) => ({ statuses: x.statuses.map((y) => (y.id === s.id ? next : y)) }));
  if (getState().settings.readReceipts) send(s.from, { k: 'status-view', id: s.id });
}

export async function deleteStatus(id) {
  await DB.del('status', id);
  setState((x) => ({ statuses: x.statuses.filter((s) => s.id !== id) }));
}

// --------------------------------------------------------------------- calls --
export async function logCall(entry) {
  await DB.put('calls', entry);
  setState((st) => ({ calls: [entry, ...st.calls.filter((c) => c.id !== entry.id)] }));
}

// ----------------------------------------------------------- wire / outbox --
const callHandlers = new Set();
export function onCallSignal(fn) {
  callHandlers.add(fn);
  return () => callHandlers.delete(fn);
}

/** Encrypt `payload` for contact `to` and push it through every live transport. */
export async function send(to, payload) {
  const st = getState();
  const c = st.contacts[to];
  if (!c?.publicJwk || !st.me) return false;
  const { iv, ct } = await seal(keys.privateKey, c.publicJwk, { ...payload, p: { name: st.me.name, postcode: st.me.postcode } });
  const env = { v: 1, id: uid(12), from: st.me.id, fromKey: st.me.publicJwk, to, ts: Date.now(), ttl: 5, iv, ct };
  seen.add(env.id);
  const ok = transmit(env);
  if (!NO_RCPT.has(payload.k) && !payload.k.startsWith('call-')) await DB.put('outbox', { id: env.id, to, env, tries: 1, at: Date.now() });
  return ok;
}

function transmit(env, exceptLink) {
  let ok = false;
  if (bus?.send(env)) ok = true;
  if (hub?.send(env)) ok = true;
  if (p2p?.send(env, exceptLink)) ok = true;
  return ok;
}

let flushing = false;
export async function flushOutbox() {
  if (flushing || !getState().me) return;
  flushing = true;
  try {
    const items = await DB.all('outbox');
    for (const it of items) {
      if (Date.now() - it.at > 14 * DAY) {
        await DB.del('outbox', it.id);
        continue;
      }
      if (transmit(it.env)) await DB.put('outbox', { ...it, tries: it.tries + 1 });
    }
  } finally {
    flushing = false;
  }
}

export async function outboxCount() {
  return (await DB.all('outbox')).length;
}

async function onEnvelope(env, via, linkId) {
  const st = getState();
  if (!st.me || !env?.id || seen.has(env.id)) return;
  seen.add(env.id);
  if (seen.size > 5000) seen.delete(seen.values().next().value);

  if (env.to !== st.me.id) {
    // mesh relay: help envelopes hop between directly linked phones
    if (via === 'p2p' && env.ttl > 0) transmit({ ...env, ttl: env.ttl - 1 }, linkId);
    return;
  }
  if ((await fingerprint(env.fromKey)) !== env.from) return;
  let payload;
  try {
    payload = await open(keys.privateKey, env.fromKey, env);
  } catch {
    return;
  }
  const from = env.from;
  let contact = st.contacts[from];
  if (contact?.blocked) return;
  if (!contact) {
    contact = await saveContact({ id: from, name: payload.p?.name || 'Unknown', postcode: payload.p?.postcode || '', publicJwk: env.fromKey, saved: false, addedAt: Date.now(), via });
  } else if (payload.p && (payload.p.name !== contact.name || payload.p.postcode !== contact.postcode)) {
    contact = await saveContact({ ...contact, name: payload.p.name, postcode: payload.p.postcode });
  }
  setState((x) => ({ presence: { ...x.presence, [from]: { online: true, lastSeen: Date.now() } } }));
  if (!NO_RCPT.has(payload.k) && !payload.k.startsWith('call-')) send(from, { k: 'rcpt', env: env.id });
  try {
    await handle(from, payload, env);
  } catch (e) {
    console.warn('2qo: failed to handle', payload.k, e);
  }
}

async function handle(from, d, env) {
  const st = getState();
  const chatIdFor = (cid) => cid || from;
  switch (d.k) {
    case 'rcpt':
      await DB.del('outbox', d.env);
      return;
    case 'msg': {
      if (d.group) await upsertGroup(d.group, from);
      const chatId = chatIdFor(d.msg.chatId);
      if (!getState().chats[chatId]) await openDirect(from);
      const chat = getState().chats[chatId];
      if (chat.type === 'channel' && chat.owner !== from) return;
      if (await DB.get('messages', d.msg.id)) return;
      let media = null;
      if (d.msg.media?.dataUrl) {
        const blob = await (await fetch(d.msg.media.dataUrl)).blob();
        await DB.putBlob(d.msg.id, blob);
        media = { ...d.msg.media, dataUrl: undefined, blobId: d.msg.id };
      }
      const msg = { ...d.msg, chatId, media, from, status: 'received', receivedAt: Date.now(), expiresAt: chat.disappearing ? Date.now() + chat.disappearing * 1000 : d.msg.expiresAt };
      setState((x) => {
        if (x.typing[chatId]?.from !== from) return {};
        const typing = { ...x.typing };
        delete typing[chatId];
        return { typing };
      });
      const viewing = getState().route.name === 'chat' && getState().route.params.id === chatId && document.visibilityState === 'visible';
      await storeMessage(msg, { unread: !viewing });
      send(from, { k: 'ack', state: 'delivered', ids: [msg.id] });
      if (viewing) markRead(chatId);
      else if (!chat.muted) notify(chat.type === 'direct' ? displayName(from) : `${displayName(from)} @ ${chat.name}`, preview(msg), chatId);
      return;
    }
    case 'ack':
      for (const id of d.ids) {
        const m = await DB.get('messages', id);
        if (!m || m.from !== st.me.id) continue;
        const chat = st.chats[m.chatId];
        if (chat?.type === 'group') {
          const key = d.state === 'read' ? 'readBy' : 'deliveredTo';
          const map = { ...(m[key] || {}), [from]: Date.now() };
          const others = (chat.members || []).filter((x) => x !== st.me.id);
          const all = others.every((o) => map[o]);
          await storeMessage({ ...m, [key]: map, status: all ? d.state : m.status === 'pending' ? 'sent' : m.status }, { bump: false });
        } else {
          await setMsgStatus(m.chatId, id, d.state, { [d.state + 'At']: Date.now() });
        }
      }
      return;
    case 'react': {
      const m = await DB.get('messages', d.msgId);
      if (!m) return;
      const reactions = { ...m.reactions };
      if (d.emoji) reactions[from] = d.emoji;
      else delete reactions[from];
      await storeMessage({ ...m, reactions }, { bump: false });
      return;
    }
    case 'edit': {
      const m = await DB.get('messages', d.msgId);
      if (m && m.from === from) await storeMessage({ ...m, text: d.text, edited: Date.now() }, { bump: false });
      return;
    }
    case 'revoke': {
      const m = await DB.get('messages', d.msgId);
      if (m && m.from === from) await storeMessage({ ...m, deleted: true, text: '', media: null, poll: null }, { bump: false });
      return;
    }
    case 'vote': {
      const m = await DB.get('messages', d.msgId);
      if (!m?.poll) return;
      applyVote(m, from, d.options);
      await storeMessage(m, { bump: false });
      return;
    }
    case 'typing': {
      const chatId = chatIdFor(d.chatId);
      setState((x) => ({ typing: { ...x.typing, [chatId]: { from, until: Date.now() + 4000 } } }));
      setTimeout(() => setState((x) => ({ typing: { ...x.typing } })), 4100);
      return;
    }
    case 'chat-setting': {
      const chatId = chatIdFor(d.chatId);
      if (!getState().chats[chatId]) await openDirect(from);
      await patchChat(chatId, { disappearing: d.disappearing });
      await systemMessage(chatId, d.disappearing ? `${displayName(from)} turned on disappearing messages (${humanDuration(d.disappearing)})` : `${displayName(from)} turned off disappearing messages`);
      return;
    }
    case 'group':
      await upsertGroup(d.group, from, d.note);
      return;
    case 'group-leave': {
      const chat = st.chats[d.chatId];
      if (!chat) return;
      await patchChat(d.chatId, { members: (chat.members || []).filter((m) => m !== from) });
      await systemMessage(d.chatId, `${displayName(from)} left`);
      return;
    }
    case 'follow': {
      const chat = st.chats[d.channelId];
      if (!chat || chat.owner !== st.me.id) return;
      const followers = new Set(chat.followers || []);
      d.on ? followers.add(from) : followers.delete(from);
      await patchChat(chat.id, { followers: [...followers] });
      return;
    }
    case 'status': {
      if (!st.contacts[from]?.saved) return; // only contacts you saved can post to your Moments
      const s = { ...d.status, from };
      if (s.expiresAt < Date.now()) return;
      await DB.put('status', s);
      setState((x) => ({ statuses: [...x.statuses.filter((y) => y.id !== s.id), s] }));
      return;
    }
    case 'status-view': {
      const s = await DB.get('status', d.id);
      if (!s || s.from !== st.me.id) return;
      const next = { ...s, views: { ...s.views, [from]: Date.now() } };
      await DB.put('status', next);
      setState((x) => ({ statuses: x.statuses.map((y) => (y.id === s.id ? next : y)) }));
      return;
    }
    case 'profile-req':
      send(from, { k: 'profile', profile: publicProfile() });
      return;
    case 'profile':
      if (d.profile?.id === from) await onAnnounce(d.profile, 'direct');
      return;
    default:
      if (d.k.startsWith('call')) callHandlers.forEach((fn) => fn(from, d));
  }
}

async function upsertGroup(g, from, note) {
  const st = getState();
  const existing = st.chats[g.id];
  if (existing && existing.type !== 'channel' && !(existing.admins || []).includes(from) && existing.owner !== from) return;
  const iAmIn = (g.members || []).includes(st.me.id) || g.type === 'channel';
  if (!iAmIn) {
    if (existing) {
      await patchChat(g.id, { ...g, left: true });
      await systemMessage(g.id, note || 'You were removed');
    }
    return;
  }
  await saveChat({ ...(existing || { unread: 0, lastTs: Date.now(), createdAt: Date.now() }), ...g, followers: existing?.followers || [], left: false });
  if (note && !existing) await systemMessage(g.id, note);
  else if (note && existing) await systemMessage(g.id, note);
}

// ------------------------------------------------------------------ helpers --
export async function blobUrl(blobId) {
  if (!blobId) return null;
  if (blobUrls.has(blobId)) return blobUrls.get(blobId);
  const b = await DB.getBlob(blobId);
  if (!b) return null;
  const u = URL.createObjectURL(b);
  blobUrls.set(blobId, u);
  return u;
}

async function sweep() {
  const now = Date.now();
  const st = getState();
  // expire Moments
  const keep = [];
  for (const s of st.statuses) {
    if (s.expiresAt > now) keep.push(s);
    else await DB.del('status', s.id);
  }
  if (keep.length !== st.statuses.length) setState({ statuses: keep });
  // disappearing messages
  for (const chat of Object.values(st.chats)) {
    if (!chat.disappearing) continue;
    const msgs = await DB.messagesFor(chat.id);
    let changed = false;
    for (const m of msgs) {
      if (m.expiresAt && m.expiresAt < now && !m.starred) {
        await DB.del('messages', m.id);
        changed = true;
      }
    }
    if (changed && st.messages[chat.id]) await loadMessages(chat.id);
  }
}

export async function starredMessages() {
  const d = await DB.db();
  return (await d.getAll('messages')).filter((m) => m.starred).sort((a, b) => b.ts - a.ts);
}

export async function searchMessages(q) {
  q = q.toLowerCase();
  const d = await DB.db();
  return (await d.getAll('messages')).filter((m) => !m.deleted && (m.text || '').toLowerCase().includes(q)).sort((a, b) => b.ts - a.ts).slice(0, 80);
}

export async function mediaFor(chatId) {
  return (await DB.messagesFor(chatId)).filter((m) => m.media && !m.deleted).reverse();
}

export function requestProfile(id) {
  send(id, { k: 'profile-req' });
}

/** Insert a message that never leaves the device (AI chat, notes, receipts of actions). */
export async function addLocalMessage(chatId, partial) {
  const msg = { id: uid(12), chatId, ts: Date.now(), reactions: {}, kind: 'text', status: 'read', ...partial };
  await storeMessage(msg);
  return msg;
}

export async function updateLocalMessage(msg) {
  await storeMessage(msg, { bump: false });
}
