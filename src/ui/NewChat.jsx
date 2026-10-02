import { useState } from 'preact/hooks';
import { useStore, go, toast } from '../lib/store.js';
import * as core from '../lib/core.js';
import { Avatar, Header, Icon, Row, Section, Field, Empty } from './kit.jsx';
import { display as pcDisplay, proximity } from '../lib/postcode/format.js';

function useContactList(q, onlySaved = false) {
  const contacts = useStore((s) => s.contacts);
  const me = useStore((s) => s.me);
  const ql = q.toLowerCase();
  return Object.values(contacts)
    .filter((c) => !c.blocked && (!onlySaved || c.saved) && (!ql || (c.alias || c.name || '').toLowerCase().includes(ql) || (c.postcode || '').toLowerCase().includes(ql.replace(/\s/g, ''))))
    .sort((a, b) => (b.saved ? 1 : 0) - (a.saved ? 1 : 0) || proximity(me.postcode, b.postcode) - proximity(me.postcode, a.postcode) || (a.name || '').localeCompare(b.name || ''));
}

export function NewChat() {
  const [q, setQ] = useState('');
  const list = useContactList(q);
  return (
    <div class="screen">
      <Header title="New chat" sub={`${list.length} contacts`} />
      <div class="search">
        <Icon name="search" size={18} />
        <input placeholder="Search name or postcode" value={q} onInput={(e) => setQ(e.target.value)} autoFocus />
      </div>
      <div class="scroll">
        <Section>
          <Row icon="users" title="New group" onClick={() => go('newgroup')} />
          <Row icon="qr" title="Add contact by QR / code" sub="Scan someone’s 2qo card" onClick={() => go('connect', { tab: 'scan' })} />
          <Row icon="nearby" title="Find people near me" sub="By postcode area" onClick={() => go('nearby')} />
          <Row icon="community" title="New community" onClick={() => go('communities', { create: true })} />
          <Row icon="channel" title="New channel" onClick={() => go('channels', { create: true })} />
        </Section>
        <Section title="Contacts on 2qo">
          {list.map((c) => (
            <Row
              avatar={<Avatar id={c.id} name={c.alias || c.name} src={c.avatar} size={44} />}
              title={c.alias || c.name}
              sub={[c.postcode && pcDisplay(c.postcode), !c.saved && 'not saved', c.about].filter(Boolean).join(' · ')}
              onClick={async () => {
                await core.openDirect(c.id);
                go('chat', { id: c.id });
              }}
            />
          ))}
          {!list.length && <Row title="No contacts yet" sub="Share your QR code or connect to a hub to discover people." />}
        </Section>
        <Section>
          <Row icon="user" title="Message yourself" onClick={() => go('chat', { id: useStoreMe() })} />
        </Section>
      </div>
    </div>
  );
}
function useStoreMe() {
  return core.publicProfile().id;
}

export function Contacts() {
  return <NewChat />;
}

/** New group or broadcast list. */
export function NewGroup({ type = 'group' }) {
  const [q, setQ] = useState('');
  const [picked, setPicked] = useState([]);
  const [step, setStep] = useState(0);
  const [name, setName] = useState('');
  const [desc, setDesc] = useState('');
  const list = useContactList(q, type === 'broadcast');
  const toggle = (id) => setPicked((p) => (p.includes(id) ? p.filter((x) => x !== id) : [...p, id]));
  const title = type === 'broadcast' ? 'New broadcast' : 'New group';

  if (step === 1)
    return (
      <div class="screen">
        <Header title={title} onBack={() => setStep(0)} />
        <div class="scroll pad">
          <Field label={type === 'broadcast' ? 'List name' : 'Group name'}>
            <input class="inp" value={name} onInput={(e) => setName(e.target.value)} autoFocus maxLength={60} />
          </Field>
          {type === 'group' && (
            <Field label="Description (optional)">
              <textarea class="inp" value={desc} onInput={(e) => setDesc(e.target.value)} />
            </Field>
          )}
          <p class="muted small">{picked.length} {type === 'broadcast' ? 'recipients' : 'members'}</p>
          <button
            class="btn block"
            disabled={!name.trim()}
            onClick={async () => {
              const chat = await core.createGroup({ name: name.trim(), members: picked, description: desc, type });
              go('chats');
              go('chat', { id: chat.id });
            }}
          >
            Create
          </button>
        </div>
      </div>
    );

  return (
    <div class="screen">
      <Header title={title} sub={picked.length ? `${picked.length} selected` : 'Add members'} />
      {picked.length > 0 && (
        <div class="sel-chips">
          {picked.map((id) => (
            <span onClick={() => toggle(id)}>
              <Avatar id={id} name={core.displayName(id)} size={24} />
              {core.displayName(id)} ✕
            </span>
          ))}
        </div>
      )}
      <div class="search">
        <Icon name="search" size={18} />
        <input placeholder="Search" value={q} onInput={(e) => setQ(e.target.value)} />
      </div>
      <div class="scroll">
        {type === 'broadcast' && <p class="muted small" style={{ padding: '0 20px' }}>Only contacts who have saved you will receive broadcast messages, as individual chats.</p>}
        <Section>
          {list.map((c) => (
            <Row
              avatar={<Avatar id={c.id} name={c.name} src={c.avatar} size={44} />}
              title={c.alias || c.name}
              sub={c.postcode ? pcDisplay(c.postcode) : ''}
              right={<span class={'check' + (picked.includes(c.id) ? ' on' : '')}>{picked.includes(c.id) && <Icon name="check" size={14} />}</span>}
              onClick={() => toggle(c.id)}
            />
          ))}
        </Section>
        {!list.length && <Empty icon="users" title="No contacts">Add people first via QR code or Nearby.</Empty>}
      </div>
      <button class="fab v" style={{ bottom: 24 }} disabled={!picked.length && type === 'broadcast'} onClick={() => (picked.length || type === 'group' ? setStep(1) : toast('Pick at least one contact'))} aria-label="Next">
        <Icon name="forward" />
      </button>
    </div>
  );
}
