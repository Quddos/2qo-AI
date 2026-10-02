// System notifications (shown through the service worker so they work when the app is backgrounded).
import { getState } from './store.js';

export async function askNotifications() {
  if (!('Notification' in globalThis)) return 'unsupported';
  if (Notification.permission === 'default') return Notification.requestPermission();
  return Notification.permission;
}

export async function notify(title, body, chatId) {
  const st = getState();
  if (!st.settings.notifications || !('Notification' in globalThis) || Notification.permission !== 'granted') return;
  if (document.visibilityState === 'visible') return;
  const opts = { body, tag: chatId, icon: '/icons/icon-192.png', badge: '/icons/badge.png', data: { chatId }, renotify: true };
  try {
    const reg = await navigator.serviceWorker?.ready;
    if (reg) return reg.showNotification(title, opts);
  } catch {}
  new Notification(title, opts);
}
