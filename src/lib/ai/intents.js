// Deterministic, offline intent parser for 2qo AI. Pure functions — no DOM, no network.
// Handles English, Nigerian English and common Pidgin phrasing. Anything it can't parse
// is handed to the on-device LLM (if one is loaded).
import { extract } from '../postcode/format.js';

const SERVICE = [
  ['police', /\b(police|polis|cop|cops|station|security|robber(y|s)?|thie(f|ves)|kidnap\w*|attack\w*|armed|gun\w*|one chance|harass\w*|assault\w*|fight\w*)\b/i],
  ['hospital', /\b(hospital|clinic|ambulance|doctor|nurse|medical|bleeding|injur\w*|sick|accident|unconscious|labou?r|pregnan\w*|heart|faint\w*)\b/i],
  ['fire', /\b(fire|burn\w*|smoke|flame\w*|explosion|gas leak)\b/i],
];

function service(text, fallback = 'police') {
  for (const [k, re] of SERVICE) if (re.test(text)) return k;
  return fallback;
}

const clean = (s) => String(s || '').replace(/^[\s,:;-]+|[\s.!?]+$/g, '').trim();

export function parseIntent(input) {
  const raw = String(input || '').trim();
  const t = raw.toLowerCase().replace(/[’']/g, "'");
  if (!t) return null;

  // --- voice notes
  let m = /\b(?:record|send)\s+(?:a\s+)?(?:voice|audio)\s*(?:note|message)?\s+(?:to|for)\s+(.+?)(?:\s+for\s+(\d+)\s*(?:sec|second)s?)?$/.exec(t);
  if (m) return { tool: 'voice_note', args: { to: clean(m[1]), seconds: m[2] ? +m[2] : 15 } };

  // --- emergencies first: they must never be missed
  const recordSituation = /\b(record|film|video|capture|tape|snap)\b.*\b(situation|this|what'?s happening|wetin dey happen|incident|everything|scene|am|it)\b/.test(t);
  const sendToStation = /\b(send|report|alert|notify|forward)\b.*\b(police|station|hospital|ambulance|fire|emergency|authorit\w*)\b/.test(t);
  const panic = /\b(sos|emergency|help me|i('m| am) in danger|save me|e don happen|dem wan|call (the )?(police|ambulance|fire))\b/.test(t);
  if (recordSituation || sendToStation || panic) {
    const mode = /\b(audio|voice|sound)\b/.test(t) && !/\bvideo\b/.test(t) ? 'audio' : 'video';
    const secs = /(\d+)\s*(sec|second|s\b)/.exec(t);
    const mins = /(\d+)\s*(min|minute)/.exec(t);
    return { tool: 'sos', args: { service: service(t), mode, seconds: secs ? +secs[1] : mins ? +mins[1] * 60 : undefined, note: raw } };
  }

  // --- places near me
  const nearPlace = /\b(nearest|closest|near(by)?|around|close to)\b.*\b(police|station|hospital|clinic|fire|pharmacy|chemist)\b|\b(police|hospital|clinic|fire station|pharmacy|chemist)\b.*\b(near|around|close)\b/.test(t);
  if (nearPlace) {
    const kind = /pharmacy|chemist/.test(t) ? 'pharmacy' : /fire/.test(t) ? 'fire' : /hospital|clinic/.test(t) ? 'hospital' : 'police';
    return { tool: 'nearest', args: { kind } };
  }
  if (/\b(people|users|person|friends|anybody|anyone|who)\b.*\b(near|around|close|my area|my postcode|same postcode)\b/.test(t)) return { tool: 'people_nearby', args: {} };

  // --- postcode
  const pc = extract(raw);
  if (pc) return { tool: 'lookup_postcode', args: { code: pc.canonical } };
  if (/\b(my|wetin be my|what'?s my|what is my)\s+(post\s?code|address|location)\b|\bwhere am i\b|\bwhere i dey\b/.test(t)) return { tool: 'my_postcode', args: {} };

  // --- calls
  m = /\b(video\s+call|call|ring|phone|dial|flash)\s+(.+?)(\s+on video|\s+with video)?$/.exec(t);
  if (m && !/\b(police|ambulance|fire)\b/.test(t)) return { tool: 'call', args: { to: clean(m[2]), video: /video/.test(m[1] + (m[3] || '')) } };

  // --- messages
  m = /^(?:please\s+)?(?:send|drop|give)\s+([a-z0-9][\w .'-]*?)\s+an?\s+(?:message|text|msg|sms)\s*(?:that|saying|say|to say|:|,)?\s+(.+)$/i.exec(raw);
  if (m) return { tool: 'send_message', args: { to: clean(m[1]), text: clean(m[2]) } };
  m = /^(?:please\s+)?(?:send|text|message|msg|tell|inform|ping|chat|drop)\s+(?:a\s+)?(?:message\s+)?(?:to\s+)?([a-z0-9][\w .'-]*?)\s*(?:that|say|saying|:|,|to say|make e know say)\s+(.+)$/i.exec(raw);
  if (m) return { tool: 'send_message', args: { to: clean(m[1]), text: clean(m[2]) } };
  m = /^(?:please\s+)?(?:send|text)\s+["“](.+)["”]\s+to\s+(.+)$/i.exec(raw);
  if (m) return { tool: 'send_message', args: { to: clean(m[2]), text: clean(m[1]) } };

  // --- read / summarise
  if (/\b(read|check|any|show|summari[sz]e|wetin)\b.*\b(message|messages|chat|chats|unread|new)\b/.test(t)) return { tool: 'read_unread', args: {} };

  // --- status
  m = /\b(?:post|set|update|share)\s+(?:my\s+)?(?:status|moment|story)\s*(?:to|saying|that|:)?\s+(.+)$/i.exec(raw);
  if (m) return { tool: 'post_status', args: { text: clean(m[1]) } };

  // --- vision
  if (/\b(what (do you|can you) see|what is this|wetin be this|describe (this|what)|look at (this|my)|read (this|the) (sign|text|label|paper)|scan this)\b/.test(t)) return { tool: 'look', args: { question: raw } };

  // --- navigation & toggles
  m = /\b(?:open|show|go to|take me to)\s+(?:my\s+)?(chats?|calls?|status|moments?|stories|nearby|settings|sos|connect|channels?|communities|starred|archived|profile)\b/.exec(t);
  if (m) {
    const map = { chat: 'chats', chats: 'chats', call: 'calls', calls: 'calls', status: 'moments', moment: 'moments', moments: 'moments', stories: 'moments', nearby: 'nearby', settings: 'settings', sos: 'sos', connect: 'connect', channel: 'channels', channels: 'channels', communities: 'communities', starred: 'starred', archived: 'archived', profile: 'profile' };
    return { tool: 'open', args: { screen: map[m[1]] } };
  }
  if (/\b(dark|night) (mode|theme)\b/.test(t)) return { tool: 'theme', args: { theme: 'dark' } };
  if (/\b(light|day) (mode|theme)\b/.test(t)) return { tool: 'theme', args: { theme: 'light' } };
  if (/\b(what can you do|help|commands|how (do|can) i use you)\b/.test(t)) return { tool: 'help', args: {} };
  if (/^(hi|hello|hey|good (morning|afternoon|evening)|how far|wetin dey)\b/.test(t)) return { tool: 'greet', args: {} };
  return null;
}

/** Fuzzy-match a spoken name against contacts. Returns the best contact or null. */
export function matchContact(name, contacts) {
  const q = String(name || '').toLowerCase().replace(/^(my|the)\s+/, '').trim();
  if (!q) return null;
  let best = null;
  let bestScore = 0;
  for (const c of contacts) {
    const names = [c.alias, c.name].filter(Boolean).map((n) => n.toLowerCase());
    for (const n of names) {
      let s = 0;
      if (n === q) s = 100;
      else if (n.split(/\s+/)[0] === q) s = 90;
      else if (n.startsWith(q)) s = 80;
      else if (n.includes(q)) s = 60;
      else {
        const d = lev(n.split(/\s+/)[0], q);
        if (d <= Math.max(1, Math.floor(q.length / 4))) s = 50 - d;
      }
      if (s > bestScore) {
        bestScore = s;
        best = c;
      }
    }
  }
  return best;
}

function lev(a, b) {
  const dp = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array(b.length).fill(0)]);
  for (let j = 1; j <= b.length; j++) dp[0][j] = j;
  for (let i = 1; i <= a.length; i++)
    for (let j = 1; j <= b.length; j++) dp[i][j] = Math.min(dp[i - 1][j] + 1, dp[i][j - 1] + 1, dp[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
  return dp[a.length][b.length];
}
