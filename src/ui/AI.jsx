import { useEffect, useLayoutEffect, useRef, useState } from 'preact/hooks';
import { useStore, go, toast, setState, getState, sheet } from '../lib/store.js';
import * as core from '../lib/core.js';
import { Icon, IconBtn, Menu } from './kit.jsx';
import { Bubble } from './Chat.jsx';
import { NetPill } from './Chats.jsx';
import { ask } from '../lib/ai/agent.js';
import { listenOnce, sttSupported, stopSpeaking } from '../lib/ai/voice.js';
import { prepare } from '../lib/ai/llm.js';

const SUGGEST = [
  'What can you do?',
  'Where am I?',
  'Nearest police station',
  'Who is near me?',
  'Read my messages',
  'Nearest hospital',
  'Check LA 11 W06 TC 10',
  'What do you see?',
];

export async function startVoice() {
  const st = getState();
  if (st.ai.listening) return;
  stopSpeaking();
  globalThis.__2qoWake?.pause();
  setState((s) => ({ ai: { ...s.ai, listening: true, partial: '' } }));
  try {
    const text = await listenOnce({ lang: st.settings.language, onPartial: (p) => setState((s) => ({ ai: { ...s.ai, partial: p } })) });
    setState((s) => ({ ai: { ...s.ai, listening: false, partial: '' } }));
    if (text) await ask(text, { fromVoice: true });
  } catch (e) {
    setState((s) => ({ ai: { ...s.ai, listening: false, partial: '' } }));
    toast(e.message);
  } finally {
    globalThis.__2qoWake?.resume();
  }
}

let prepared = false;

export function AIScreen() {
  const msgs = useStore((s) => s.messages[core.AI_CHAT]);
  const chat = useStore((s) => s.chats[core.AI_CHAT]);
  const ai = useStore((s) => s.ai);
  const me = useStore((s) => s.me);
  const settings = useStore((s) => s.settings);
  const [text, setText] = useState('');
  const scroller = useRef();
  const camRef = useRef();

  useEffect(() => {
    core.loadMessages(core.AI_CHAT).then(() => core.patchChat(core.AI_CHAT, { unread: 0 }));
    if (!prepared && settings.aiEngine !== 'rules') {
      prepared = true;
      // only auto-load engines that need no big download; WebLLM loads when chosen in settings
      prepare(settings.aiEngine === 'webllm' ? 'webllm' : 'auto').catch(() => {});
    }
  }, []);
  useLayoutEffect(() => {
    if (scroller.current) scroller.current.scrollTop = scroller.current.scrollHeight;
  }, [msgs?.length, ai.thinking, ai.partial]);

  const engineLabel = { rules: 'Command engine (offline)', chrome: 'Gemini Nano · on-device', webllm: 'Local LLM · on-device' }[ai.engine];
  async function submit() {
    const t = text.trim();
    if (!t) return;
    setText('');
    await ask(t);
  }

  if (!chat) return null;
  return (
    <div class="screen">
      <header class="hdr">
        <div class="brand"><b style={{ fontSize: '1.35rem' }}>2qo AI</b></div>
        <div class="spacer" />
        <NetPill />
        <IconBtn
          name="more"
          label="AI options"
          onClick={() =>
            sheet(
              <Menu
                items={[
                  { icon: 'settings', label: 'AI & voice settings', onClick: () => go('settings', { section: 'ai' }) },
                  { icon: 'siren', label: 'SOS & emergency', onClick: () => go('sos') },
                  { icon: 'trash', label: 'Clear AI conversation', danger: true, onClick: () => core.clearChat(core.AI_CHAT) },
                ]}
              />,
            )
          }
        />
      </header>
      <div class="ai-hero">
        <button class={'bigorb' + (ai.listening ? ' listening' : '')} onClick={() => (ai.recording ? ai.stopRecording?.() : startVoice())} aria-label="Talk to 2qo AI">
          <Icon name={ai.recording ? 'stop' : 'mic'} size={32} />
        </button>
        <div>
          <h2>{ai.listening ? 'Listening…' : ai.recording ? `Recording voice note… tap to stop` : ai.thinking ? 'Working on it…' : `Hi ${me.name.split(' ')[0]}, say “Hey 2qo”`}</h2>
          <small>
            {engineLabel}
            {ai.engineStatus === 'downloading' ? ` · downloading ${Math.round((ai.progress || 0) * 100)}%` : ''} · {settings.wakeWord ? (ai.wake ? 'wake word on' : 'wake word starting…') : 'tap orb to talk'}
          </small>
          {ai.engineStatus === 'downloading' && <div class="progress"><b style={{ width: (ai.progress || 0) * 100 + '%' }} /></div>}
        </div>
      </div>
      <div class="suggest">
        {SUGGEST.map((s) => (
          <button onClick={() => ask(s)}>{s}</button>
        ))}
      </div>
      <div class="conv wp-plain" ref={scroller} style={{ paddingBottom: 10 }}>
        {!msgs?.length && <div class="sys">Everything you say to 2qo AI stays on this phone. It can message, call, find places, read postcodes, and run SOS — even with no internet.</div>}
        {(msgs || []).map((m, i) => (
          <Bubble key={m.id} m={m} chat={chat} prev={msgs[i - 1]} mine={m.from === me.id} onAction={() => {}} />
        ))}
        {ai.thinking && (
          <div class="typing"><i /><i /><i /></div>
        )}
      </div>
      {ai.partial && <div class="partial">“{ai.partial}”</div>}
      <div class="composer" style={{ paddingBottom: 'calc(var(--dock-h) + 22px)' }}>
        <div class="cbox">
          <IconBtn name="camera" label="Show 2qo AI something" onClick={() => camRef.current.click()} />
          <input ref={camRef} type="file" accept="image/*" capture="environment" hidden onChange={(e) => e.target.files[0] && ask(text || 'What is in this picture? Mention anything dangerous.', { image: e.target.files[0] })} />
          <textarea rows={1} value={text} placeholder="Ask or command 2qo AI…" onInput={(e) => setText(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && !e.shiftKey && (e.preventDefault(), submit())} />
        </div>
        {text.trim() ? (
          <button class="sendbtn" onClick={submit} aria-label="Send"><Icon name="send" /></button>
        ) : (
          <button class={'sendbtn' + (ai.listening ? ' rec' : '')} onClick={startVoice} aria-label="Speak" disabled={!sttSupported}><Icon name="mic" /></button>
        )}
      </div>
    </div>
  );
}
