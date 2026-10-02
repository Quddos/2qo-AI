import { render } from 'preact';
import './styles.css';

// ?as=<name> runs an isolated profile in this browser (separate database), handy for
// trying 2qo with several "people" in different tabs — they talk over the local bus.
const as = new URLSearchParams(location.search).get('as');
if (as) globalThis.__2QO_DB_SUFFIX__ = ':' + as.replace(/[^\w-]/g, '').slice(0, 24);

if (!globalThis.isSecureContext || !globalThis.crypto?.subtle) {
  document.getElementById('app').innerHTML = `<div style="font-family:system-ui;padding:32px;max-width:520px;margin:auto">
    <h2>2qo needs a secure connection</h2>
    <p>Encryption, microphone and camera only work over <b>https://</b> (or localhost).
    If you opened a 2qo Hub by IP address, restart it with <code>HTTPS=1 npm run hub</code> and open the <b>https://</b> address,
    then accept the certificate warning once.</p></div>`;
  throw new Error('insecure context');
}

const { App } = await import('./ui/App.jsx');
const { init } = await import('./lib/core.js');
const { back, canGoBack } = await import('./lib/store.js');

render(<App />, document.getElementById('app'));
const qp = new URLSearchParams(location.search);
init().then(async () => {
  const { go, getState, toast } = await import('./lib/store.js');
  if (!getState().me) return;
  if (qp.get('go')) go(qp.get('go'));
  if (qp.get('chat')) go('chat', { id: qp.get('chat') });
  if (qp.get('share')) {
    const text = [qp.get('title'), qp.get('text'), qp.get('url')].filter(Boolean).join('\n');
    const { forwardSheet } = await import('./ui/Chat.jsx');
    forwardSheet({ kind: 'text', text });
    toast('Choose chats to share with');
  }
});

// Hardware/browser back button walks the in-app stack before leaving the app.
history.pushState({ app: 1 }, '');
addEventListener('popstate', () => {
  if (canGoBack()) {
    back();
    history.pushState({ app: 1 }, '');
  } else history.back();
});

if ('serviceWorker' in navigator && import.meta.env.PROD) {
  import('virtual:pwa-register').then(({ registerSW }) => registerSW({ immediate: true }));
  navigator.serviceWorker.addEventListener('message', (e) => {
    if (e.data?.type === 'open-chat') import('./lib/store.js').then(({ go }) => go('chat', { id: e.data.chatId }));
  });
}
