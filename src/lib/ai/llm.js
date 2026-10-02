// On-device language models. Nothing here sends your words to a cloud service.
//   chrome : Chrome's built-in Prompt API (Gemini Nano). Fully on-device, multimodal (image) where supported.
//   webllm : WebLLM running a small open model on WebGPU. Downloaded once, then cached for offline use.
//   rules  : 2qo's deterministic command engine — always available, zero download.
import { getState, setState } from '../store.js';

export const WEBLLM_MODELS = [
  { id: 'Qwen2.5-1.5B-Instruct-q4f16_1-MLC', label: 'Qwen 2.5 1.5B (≈1 GB, recommended)' },
  { id: 'Llama-3.2-1B-Instruct-q4f16_1-MLC', label: 'Llama 3.2 1B (≈0.9 GB)' },
  { id: 'SmolLM2-360M-Instruct-q4f16_1-MLC', label: 'SmolLM2 360M (≈0.4 GB, low-end phones)' },
];
const WEBLLM_CDN = 'https://esm.run/@mlc-ai/web-llm@0.2.85';

let chromeSession = null;
let webllm = null;

function status(engine, engineStatus, extra = {}) {
  setState((s) => ({ ai: { ...s.ai, engine, engineStatus, ...extra } }));
}

export async function detect() {
  const out = { chrome: 'unavailable', webgpu: !!navigator.gpu, webllmCached: false };
  try {
    if (globalThis.LanguageModel?.availability) out.chrome = await LanguageModel.availability();
  } catch {}
  try {
    const keys = await caches.keys();
    out.webllmCached = keys.some((k) => k.includes('webllm'));
  } catch {}
  return out;
}

/** Load the preferred engine. Resolves to the engine actually in use. */
export async function prepare(pref = getState().settings.aiEngine, onProgress) {
  if (pref === 'rules') {
    status('rules', 'ready');
    return 'rules';
  }
  const caps = await detect();
  if ((pref === 'auto' || pref === 'chrome') && caps.chrome !== 'unavailable') {
    try {
      status('chrome', caps.chrome === 'available' ? 'loading' : 'downloading');
      chromeSession = await LanguageModel.create({
        expectedInputs: [{ type: 'text' }, { type: 'image' }],
        initialPrompts: [{ role: 'system', content: SYSTEM }],
        monitor(m) {
          m.addEventListener('downloadprogress', (e) => {
            status('chrome', 'downloading', { progress: e.loaded });
            onProgress?.(e.loaded);
          });
        },
      }).catch(() => LanguageModel.create({ initialPrompts: [{ role: 'system', content: SYSTEM }] }));
      status('chrome', 'ready');
      return 'chrome';
    } catch (e) {
      console.warn('Chrome AI unavailable', e);
    }
  }
  if ((pref === 'auto' && caps.webllmCached) || pref === 'webllm') {
    if (!caps.webgpu) {
      status('rules', 'ready', { note: 'WebGPU not available on this device — using the built-in command engine.' });
      return 'rules';
    }
    try {
      status('webllm', 'downloading', { progress: 0 });
      const lib = await import(/* @vite-ignore */ WEBLLM_CDN);
      const model = getState().settings.webllmModel || WEBLLM_MODELS[0].id;
      webllm = await lib.CreateMLCEngine(model, {
        initProgressCallback: (p) => {
          status('webllm', 'downloading', { progress: p.progress, note: p.text });
          onProgress?.(p.progress);
        },
      });
      status('webllm', 'ready', { note: model });
      return 'webllm';
    } catch (e) {
      status('rules', 'ready', { note: 'Could not load the local model (' + e.message + '). Using the command engine.' });
      return 'rules';
    }
  }
  status('rules', 'ready');
  return 'rules';
}

export const hasLLM = () => !!(chromeSession || webllm);

/** Free-form chat with the local model. history: [{role, content}] */
export async function complete(history, { image, json = false } = {}) {
  if (chromeSession) {
    const s = await chromeSession.clone();
    const last = history[history.length - 1];
    const content = image ? [{ type: 'text', value: last.content }, { type: 'image', value: image }] : last.content;
    const prior = history.slice(0, -1).map((m) => `${m.role}: ${m.content}`).join('\n');
    const prompt = image ? [{ role: 'user', content }] : (prior ? prior + '\nuser: ' : '') + last.content;
    const out = await s.prompt(prompt);
    s.destroy?.();
    return out;
  }
  if (webllm) {
    const r = await webllm.chat.completions.create({
      messages: [{ role: 'system', content: SYSTEM }, ...history.slice(-10)],
      temperature: json ? 0 : 0.6,
      max_tokens: 400,
      ...(json ? { response_format: { type: 'json_object' } } : {}),
    });
    return r.choices[0].message.content;
  }
  return null;
}

export const SYSTEM = `You are 2qo AI, a helpful assistant inside the 2qo messaging app used in Nigeria.
You run fully on the user's phone. Be brief, warm and practical. You understand Nigerian English and Pidgin.
You can operate the app with tools. When the user asks you to DO something, reply ONLY with JSON:
{"tool": "<name>", "args": {...}}
Tools:
- send_message {to, text}
- call {to, video:boolean}
- voice_note {to, seconds}
- sos {service:"police"|"hospital"|"fire", mode:"video"|"audio"}
- nearest {kind:"police"|"hospital"|"fire"|"pharmacy"}
- people_nearby {}
- my_postcode {}
- lookup_postcode {code}
- post_status {text}
- read_unread {}
- open {screen:"chats"|"moments"|"calls"|"nearby"|"settings"|"sos"|"connect"}
If no tool fits, answer normally in plain text (max 3 sentences).`;
