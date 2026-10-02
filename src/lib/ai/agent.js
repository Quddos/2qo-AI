// 2qo AI agent: turns a spoken/typed request into app actions ("tools") and reports back.
// Perception: text, voice, camera frames. Action: messaging, calls, SOS, search, navigation.
import { getState, setState, go, toast } from '../store.js';
import * as core from '../core.js';
import { parseIntent, matchContact } from './intents.js';
import { complete, hasLLM } from './llm.js';
import { speak } from './voice.js';
import { runSOS } from '../sos.js';
import { nearest, KINDS, fmtDistance } from '../places.js';
import { whereAmI, lookup } from '../postcode/client.js';
import { display, proximity, PROXIMITY_PHRASE } from '../postcode/format.js';
import { startRecording, snapshot, fileToDataURL } from '../media.js';
import { startCall } from '../calls.js';

const AI = core.AI_CHAT;

async function say(text, extra = {}) {
  await core.addLocalMessage(AI, { from: 'ai', text, ...extra });
  if (getState().settings.voiceReplies && extra.speak !== false) {
    setState((s) => ({ ai: { ...s.ai, speaking: true } }));
    speak(text, { lang: getState().settings.language, onEnd: () => setState((s) => ({ ai: { ...s.ai, speaking: false } })) });
  }
}

function contacts() {
  return Object.values(getState().contacts).filter((c) => !c.blocked);
}

function findContact(name) {
  const c = matchContact(name, contacts());
  if (c) return c;
  const st = getState();
  const chat = Object.values(st.chats).find((x) => ['group', 'channel', 'broadcast'].includes(x.type) && x.name.toLowerCase().includes(String(name).toLowerCase()));
  return chat ? { id: chat.id, name: chat.name, isChat: true } : null;
}

/** Main entry: user said/typed `text`. */
export async function ask(text, { fromVoice = false, image = null } = {}) {
  text = String(text || '').trim();
  if (!text && !image) return;
  await core.addLocalMessage(AI, { from: getState().me.id, text: text || '📷', via: fromVoice ? 'voice' : 'text' });
  setState((s) => ({ ai: { ...s.ai, thinking: true } }));
  try {
    let intent = image ? { tool: 'look', args: { question: text, image } } : parseIntent(text);
    if (!intent && hasLLM()) intent = await llmIntent(text);
    if (!intent) return await chitchat(text);
    await run(intent, text);
  } catch (e) {
    await say('Sorry, that didn’t work: ' + e.message);
  } finally {
    setState((s) => ({ ai: { ...s.ai, thinking: false } }));
  }
}

async function llmIntent(text) {
  const history = await recentHistory();
  const out = await complete([...history, { role: 'user', content: text }]);
  if (!out) return null;
  const m = /\{[\s\S]*\}/.exec(out);
  if (m) {
    try {
      const j = JSON.parse(m[0]);
      if (j.tool) return j;
    } catch {}
  }
  await say(out.trim());
  return { tool: 'noop' };
}

async function recentHistory() {
  const msgs = (getState().messages[AI] || []).slice(-8);
  return msgs.filter((m) => m.text).map((m) => ({ role: m.from === 'ai' ? 'assistant' : 'user', content: m.text }));
}

async function chitchat(text) {
  if (hasLLM()) {
    const out = await complete([...(await recentHistory()), { role: 'user', content: text }]);
    if (out) return say(out.trim());
  }
  return say(`I didn’t get that yet. Try: “send Ada a message that I’m on my way”, “call Bayo”, “where am I”, “nearest hospital”, or “record my situation and send it to the nearest police station”. You can also load an on-device model in AI settings for free-form chat.`);
}

export async function run(intent, original = '') {
  const { tool, args = {} } = intent;
  const st = getState();
  switch (tool) {
    case 'noop':
      return;
    case 'greet':
      return say(`Hi ${st.me.name.split(' ')[0]}! I’m 2qo AI and I work even without data. Ask me to message or call someone, find who’s near your postcode, or say “SOS” in an emergency.`);
    case 'help':
      return say(HELP, { speak: false });
    case 'sos': {
      const svc = KINDS[args.service] ? args.service : 'police';
      await say(`Emergency mode: recording ${args.mode || 'video'} now and alerting the nearest ${KINDS[svc].label.toLowerCase()}. Tap Cancel if this is a mistake.`, { speak: false });
      speak(`Recording. Alerting nearest ${KINDS[svc].label}.`);
      const log = await runSOS({ service: svc, mode: args.mode, seconds: args.seconds, note: args.note || original });
      if (log) await say(`SOS done. ${log.station ? `Nearest: ${log.station.name}, ${fmtDistance(log.station.distance)} away.` : ''} ${log.delivered.length ? 'Sent to ' + log.delivered.join(', ') + '.' : 'Use the SMS or Call buttons to reach ' + (st.settings.emergencyNumber || '112') + '.'}`, { sosId: log.id });
      return;
    }
    case 'nearest': {
      const kind = KINDS[args.kind] ? args.kind : 'police';
      const where = await whereAmI().catch(() => null);
      if (!where) return say('I need your location for that. Please allow location access.');
      const { places, online } = await nearest(kind, where.lat, where.lng);
      if (!places.length) return say(`I couldn’t find a ${KINDS[kind].label.toLowerCase()} near you${online ? '' : ' in my offline cache'}. ${online ? '' : 'Connect once so I can save places around you for offline use.'}`);
      const p = places[0];
      return say(`Nearest ${KINDS[kind].label.toLowerCase()}: ${p.name}, about ${fmtDistance(p.distance)} away${p.phone ? ', phone ' + p.phone : ''}.`, { places: places.slice(0, 5), placeKind: kind });
    }
    case 'people_nearby':
      go('nearby');
      return say(st.me.postcode ? `Showing people near ${display(st.me.postcode)}.` : 'Add your postcode in your profile so I can find people near you.');
    case 'my_postcode': {
      try {
        const w = await whereAmI();
        if (w.postcode) return say(`Your postcode here is ${display(w.postcode)}${w.address ? ' — ' + w.address : ''}.`, { postcode: w.postcode });
        return say(`You’re at ${w.lat.toFixed(5)}, ${w.lng.toFixed(5)}. ${w.message || 'I couldn’t resolve a postcode for this spot.'}${st.me.postcode ? ` Your saved postcode is ${display(st.me.postcode)}.` : ''}`);
      } catch (e) {
        return say(st.me.postcode ? `Your saved postcode is ${display(st.me.postcode)}. (${e.message})` : e.message);
      }
    }
    case 'lookup_postcode': {
      const r = await lookup(args.code, 1);
      if (!r.valid) return say(`${display(args.code)} is not a valid postcode. ${r.error || ''}`);
      const a = r.administrative_address || {};
      const near = st.me.postcode ? ` It’s ${PROXIMITY_PHRASE[proximity(st.me.postcode, args.code)]}.` : '';
      return say(`${display(args.code)} is valid: ${[a.area_name, a.district_name, a.lga_name, a.state_name].filter(Boolean).join(', ') || `state ${a.state}, LGA ${a.lga}, district ${a.district}, area ${a.area}, unit ${a.unit}`}.${r._offline ? ' (checked offline)' : ''}${near}`, { postcode: args.code });
    }
    case 'send_message': {
      const c = findContact(args.to);
      if (!c) return say(`I couldn’t find “${args.to}” in your contacts.`);
      const chat = c.isChat ? st.chats[c.id] : await core.openDirect(c.id);
      await core.sendMessage(chat.id, { kind: 'text', text: args.text });
      return say(`Sent to ${c.alias || c.name}: “${args.text}”`, { link: chat.id });
    }
    case 'voice_note': {
      const c = findContact(args.to);
      if (!c) return say(`I couldn’t find “${args.to}” in your contacts.`);
      const secs = Math.min(120, args.seconds || 15);
      speak(`Recording for ${secs} seconds`);
      await new Promise((r) => setTimeout(r, 1600));
      const rec = await startRecording('audio', { maxSeconds: secs });
      setState((s) => ({ ai: { ...s.ai, recording: secs, stopRecording: () => rec.stop() } }));
      const out = await rec.finished;
      setState((s) => ({ ai: { ...s.ai, recording: 0, stopRecording: null } }));
      const chat = c.isChat ? st.chats[c.id] : await core.openDirect(c.id);
      await core.sendMessage(chat.id, { kind: 'audio', media: { blob: out.blob, mime: out.mime, duration: out.duration, dataUrl: await fileToDataURL(out.blob) } });
      return say(`Voice note (${out.duration}s) sent to ${c.name}.`, { link: chat.id });
    }
    case 'call': {
      const c = findContact(args.to);
      if (!c || c.isChat) return say(`I couldn’t find “${args.to}” to call.`);
      await say(`Calling ${c.name}${args.video ? ' on video' : ''}…`, { speak: false });
      return startCall(c.id, !!args.video);
    }
    case 'read_unread': {
      const chats = Object.values(st.chats).filter((c) => c.unread > 0 && c.type !== 'ai');
      if (!chats.length) return say('No unread messages. You’re all caught up!');
      const lines = chats.slice(0, 5).map((c) => `${c.name}: ${c.unread} new — last: “${c.lastPreview}”`);
      return say(`You have unread messages in ${chats.length} chat${chats.length > 1 ? 's' : ''}. ${lines.join('. ')}`);
    }
    case 'post_status':
      await core.postStatus({ kind: 'text', text: args.text });
      return say(`Posted to your Moments: “${args.text}”`);
    case 'open':
      go(args.screen);
      return say(`Opening ${args.screen}.`, { speak: false });
    case 'theme':
      await core.updateSettings({ theme: args.theme });
      return say(`Switched to ${args.theme} mode.`);
    case 'look':
      return look(args.question, args.image);
    default:
      return say('I can’t do that yet.');
  }
}

async function look(question, image) {
  let blob = image;
  if (!blob) {
    try {
      blob = await snapshot('environment');
    } catch {
      return say('I need camera permission to look.');
    }
  }
  const url = await fileToDataURL(blob);
  await core.addLocalMessage(AI, { from: getState().me.id, kind: 'image', text: '', media: null, inlineImage: url });
  if (!hasLLM()) return say('I captured the picture. To describe images offline, enable Chrome’s on-device AI (Gemini Nano) in AI settings. You can still forward this photo to a contact.');
  const bmp = await createImageBitmap(blob);
  const out = await complete([{ role: 'user', content: question || 'Describe what you see briefly. Point out anything dangerous.' }], { image: bmp });
  return say(out || 'I couldn’t analyse that image with the current model (text-only). Try Chrome on-device AI for vision.');
}

const HELP = `Here’s what I can do — all of it works offline:
• “Send Ada a message that I’m on my way”
• “Call Bayo” / “Video call mum”
• “Record a voice note to Chika for 20 seconds”
• “Record my situation and send it to the nearest police station” (SOS)
• “Nearest hospital” · “Who is near me?” · “What’s my postcode?”
• “Check LA 11 W06 TC 10” — validate & look up any postcode
• “Read my messages” · “Post status: Market day!” · “What do you see?”
Turn on “Hey 2qo” in AI settings to use me hands-free.`;
