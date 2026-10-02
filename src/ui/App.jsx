import { useEffect } from 'preact/hooks';
import { useStore, go, getState, setState, toast } from '../lib/store.js';
import { Icon, SheetHost, Toast, Logo } from './kit.jsx';
import { Onboarding } from './Onboarding.jsx';
import { ChatList, Archived, Starred, GlobalSearch } from './Chats.jsx';
import { Chat } from './Chat.jsx';
import { ChatInfo, ContactInfo } from './ChatInfo.jsx';
import { NewChat, NewGroup, Contacts } from './NewChat.jsx';
import { Moments } from './Moments.jsx';
import { Calls, CallScreen } from './Calls.jsx';
import { Nearby, PostcodeTool } from './Nearby.jsx';
import { AIScreen, startVoice } from './AI.jsx';
import { SOSScreen, SOSOverlay } from './SOS.jsx';
import { Connect } from './Connect.jsx';
import { Settings, Profile } from './Settings.jsx';
import { Channels, Communities, Community } from './Spaces.jsx';
import { wakeListener } from '../lib/ai/voice.js';
import { ask } from '../lib/ai/agent.js';

const SCREENS = {
  chats: ChatList,
  moments: Moments,
  ai: AIScreen,
  calls: Calls,
  nearby: Nearby,
  chat: Chat,
  chatinfo: ChatInfo,
  contact: ContactInfo,
  newchat: NewChat,
  newgroup: NewGroup,
  contacts: Contacts,
  archived: Archived,
  starred: Starred,
  search: GlobalSearch,
  settings: Settings,
  profile: Profile,
  connect: Connect,
  sos: SOSScreen,
  channels: Channels,
  communities: Communities,
  community: Community,
  postcode: PostcodeTool,
};

const DOCK = [
  ['chats', 'chat', 'Chats'],
  ['moments', 'moments', 'Moments'],
  ['ai', 'sparkle', '2qo AI'],
  ['calls', 'calls', 'Calls'],
  ['nearby', 'nearby', 'Nearby'],
];

function useTheme() {
  const s = useStore((x) => x.settings);
  useEffect(() => {
    const r = document.documentElement;
    if (s.theme === 'auto' || !s.theme) r.removeAttribute('data-theme');
    else r.dataset.theme = s.theme;
    r.dataset.accent = s.accent || 'sun';
    r.style.setProperty('--fs', (s.fontSize || 16) + 'px');
  }, [s.theme, s.accent, s.fontSize]);
}

function useWakeWord() {
  const on = useStore((s) => s.settings.wakeWord && !!s.me);
  const lang = useStore((s) => s.settings.language);
  useEffect(() => {
    if (!on) return;
    const w = wakeListener({
      lang,
      onWake: () => {
        go('ai');
        startVoice();
      },
      onCommand: (cmd) => {
        toast('🎙️ ' + cmd);
        ask(cmd, { fromVoice: true });
      },
      onState: (st) => {
        setState((x) => ({ ai: { ...x.ai, wake: st === 'listening' } }));
        if (st === 'denied') toast('Microphone permission is needed for “Hey 2qo”');
      },
    });
    if (!w) {
      toast('Voice wake-up is not supported in this browser');
      return;
    }
    globalThis.__2qoWake = w;
    return () => {
      w.stop();
      globalThis.__2qoWake = null;
    };
  }, [on, lang]);
}

function Dock({ route }) {
  const unread = useStore((s) => Object.values(s.chats).filter((c) => (c.unread > 0 || c.markedUnread) && !c.archived && c.type !== 'ai').length);
  const newMoments = useStore((s) => s.statuses.some((x) => !x.viewed && x.from !== s.me?.id));
  const missed = useStore((s) => s.calls.filter((c) => c.outcome === 'missed' && !c.seen).length);
  const ai = useStore((s) => s.ai);
  return (
    <nav class="dock" aria-label="Main">
      {DOCK.map(([name, icon, label]) =>
        name === 'ai' ? (
          <button class={'orb' + (ai.listening ? ' listening' : '') + (ai.wake ? ' wake' : '')} onClick={() => (route === 'ai' ? startVoice() : go('ai'))} aria-label="2qo AI" title="2qo AI — tap to talk">
            <Icon name={ai.listening ? 'mic' : 'sparkle'} size={28} />
          </button>
        ) : (
          <button class={route === name ? 'on' : ''} onClick={() => go(name)}>
            <Icon name={icon} fill={route === name && icon !== 'moments'} stroke={route === name ? 1.4 : 1.8} />
            {label}
            {name === 'chats' && unread > 0 && <span class="badge">{unread}</span>}
            {name === 'moments' && newMoments && <span class="badge" style={{ minWidth: 10, height: 10, padding: 0, top: -2, right: 18 }} />}
            {name === 'calls' && missed > 0 && <span class="badge" style={{ background: 'var(--red)' }}>{missed}</span>}
          </button>
        ),
      )}
    </nav>
  );
}

export function App() {
  const ready = useStore((s) => s.ready);
  const me = useStore((s) => s.me);
  const route = useStore((s) => s.route);
  const online = useStore((s) => s.net.online);
  useTheme();
  useWakeWord();

  if (!ready)
    return (
      <div class="shell" style={{ display: 'grid', placeItems: 'center' }}>
        <Logo size={72} />
      </div>
    );
  if (!me) return <Onboarding />;

  const Screen = SCREENS[route.name] || ChatList;
  const tab = DOCK.some(([n]) => n === route.name);
  return (
    <div class="shell">
      {!online && <div class="offline-banner">Offline mode · chats, AI & SOS still work on this device and nearby links</div>}
      <Screen key={route.name + (route.params.id || '')} {...route.params} />
      {tab && <Dock route={route.name} />}
      <CallScreen />
      <SOSOverlay />
      <SheetHost />
      <Toast />
    </div>
  );
}
