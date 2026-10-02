// Tiny reactive store used by every screen.
import { useEffect, useReducer, useRef } from 'preact/hooks';

let state = {
  ready: false,
  me: null,
  settings: {},
  contacts: {},
  chats: {},
  messages: {},
  statuses: [],
  calls: [],
  route: { name: 'chats', params: {} },
  stack: [],
  net: { bus: true, hub: 'off', peers: [], online: typeof navigator !== 'undefined' ? navigator.onLine : true },
  typing: {},
  presence: {},
  toast: null,
  call: null,
  ai: { listening: false, wake: false, engine: 'rules', engineStatus: 'ready', speaking: false, partial: '' },
  sos: null,
  unlocked: {},
  sheet: null,
};
const subs = new Set();

export const getState = () => state;

export function setState(patch) {
  const next = typeof patch === 'function' ? patch(state) : patch;
  state = { ...state, ...next };
  subs.forEach((f) => f());
}

export function subscribe(fn) {
  subs.add(fn);
  return () => subs.delete(fn);
}

export function useStore(selector = (s) => s) {
  const [, force] = useReducer((x) => x + 1, 0);
  const sel = useRef(selector);
  sel.current = selector;
  const val = useRef(selector(state));
  val.current = selector(state);
  useEffect(() => {
    const check = () => {
      const v = sel.current(state);
      if (v !== val.current) {
        val.current = v;
        force();
      }
    };
    const unsub = subscribe(check);
    check(); // state may have changed between render and this effect
    return unsub;
  }, []);
  return val.current;
}

// ---- navigation -------------------------------------------------------------
const TABS = ['chats', 'moments', 'ai', 'calls', 'nearby'];
export function go(name, params = {}) {
  if (TABS.includes(name)) setState({ route: { name, params }, stack: [] });
  else setState((s) => ({ stack: [...s.stack, s.route], route: { name, params } }));
}
export function canGoBack() {
  const s = state;
  return !!(s.sheet || s.stack.length || s.route.name !== 'chats');
}

export function back() {
  setState((s) => {
    if (s.sheet) return { sheet: null };
    if (!s.stack.length) return s.route.name === 'chats' ? {} : { route: { name: 'chats', params: {} } };
    const stack = s.stack.slice();
    return { route: stack.pop(), stack };
  });
}

let toastTimer;
export function toast(text, ms = 2600) {
  clearTimeout(toastTimer);
  setState({ toast: text });
  toastTimer = setTimeout(() => setState({ toast: null }), ms);
}

export function sheet(content) {
  setState({ sheet: content });
}
