// Voice I/O: speech-to-text with an always-on "Hey 2qo" wake phrase, and text-to-speech.
// Uses the platform speech engine. On Chrome/Android with on-device speech packs
// (processLocally) recognition runs without internet; TTS voices are local on all platforms.

const SR = globalThis.SpeechRecognition || globalThis.webkitSpeechRecognition;
export const sttSupported = !!SR;
export const ttsSupported = 'speechSynthesis' in globalThis;

// "hey 2qo" is heard many ways by recognisers; accept the common variants.
const WAKE = /\b(hey|hi|ok|okay|hello|yo)[\s,]+(2\s?qo|two\s?q\s?o|to\s?q\s?o|2\s?q\s?o|tuku|two\s?cue|to\s?cue|2\s?cue|toku|two\s?queue|to\s?queue|tq|2qo ai|q\s?o)\b[\s,.!]*(ai)?[\s,.!]*/i;

export function stripWake(text) {
  const m = WAKE.exec(text);
  if (!m) return null;
  return text.slice(m.index + m[0].length).trim();
}

/** One-shot listen. Resolves with the final transcript. */
export function listenOnce({ lang = 'en-NG', onPartial, timeout = 12000 } = {}) {
  return new Promise((resolve, reject) => {
    if (!SR) return reject(new Error('Speech recognition is not supported in this browser — type your command instead.'));
    const r = new SR();
    r.lang = lang;
    r.interimResults = true;
    r.maxAlternatives = 1;
    try {
      r.processLocally = true; // on-device recognition where available
    } catch {}
    let final = '';
    const t = setTimeout(() => r.stop(), timeout);
    r.onresult = (e) => {
      let interim = '';
      for (let i = e.resultIndex; i < e.results.length; i++) {
        if (e.results[i].isFinal) final += e.results[i][0].transcript;
        else interim += e.results[i][0].transcript;
      }
      onPartial?.(final + interim);
    };
    r.onerror = (e) => {
      clearTimeout(t);
      if (e.error === 'language-not-supported' || e.error === 'service-not-allowed') {
        try {
          r.processLocally = false;
        } catch {}
      }
      reject(new Error(e.error === 'not-allowed' ? 'Microphone permission denied' : e.error === 'network' ? 'Speech recognition needs a network on this device — install the offline speech pack or type instead.' : 'Didn’t catch that'));
    };
    r.onend = () => {
      clearTimeout(t);
      resolve(final.trim());
    };
    r.start();
  });
}

/**
 * Continuous wake-word listener. Calls onCommand(text) when "Hey 2qo …" is heard.
 * If the user only says "Hey 2qo", onWake() fires so the app can open the mic for the command.
 */
export function wakeListener({ lang = 'en-NG', onWake, onCommand, onState }) {
  if (!SR) return null;
  let r;
  let alive = true;
  let paused = false;
  function start() {
    if (!alive || paused) return;
    r = new SR();
    r.lang = lang;
    r.continuous = true;
    r.interimResults = false;
    try {
      r.processLocally = true;
    } catch {}
    r.onresult = (e) => {
      const text = e.results[e.results.length - 1][0].transcript;
      const cmd = stripWake(text);
      if (cmd === null) return;
      if (cmd.length > 2) onCommand(cmd);
      else onWake();
    };
    r.onend = () => alive && !paused && setTimeout(start, 400);
    r.onerror = (e) => {
      if (e.error === 'not-allowed') {
        alive = false;
        onState?.('denied');
      }
    };
    try {
      r.start();
      onState?.('listening');
    } catch {}
  }
  start();
  return {
    pause() {
      paused = true;
      try {
        r?.abort();
      } catch {}
    },
    resume() {
      if (paused) {
        paused = false;
        start();
      }
    },
    stop() {
      alive = false;
      try {
        r?.abort();
      } catch {}
      onState?.('off');
    },
  };
}

export function speak(text, { lang = 'en-NG', rate = 1.02, onEnd } = {}) {
  if (!ttsSupported || !text) return onEnd?.();
  speechSynthesis.cancel();
  const u = new SpeechSynthesisUtterance(String(text).replace(/[*_`#>]/g, ''));
  u.lang = lang;
  u.rate = rate;
  const voices = speechSynthesis.getVoices();
  u.voice = voices.find((v) => v.lang === lang && v.localService) || voices.find((v) => v.lang?.startsWith('en') && v.localService) || null;
  u.onend = () => onEnd?.();
  u.onerror = () => onEnd?.();
  speechSynthesis.speak(u);
}

export const stopSpeaking = () => ttsSupported && speechSynthesis.cancel();
