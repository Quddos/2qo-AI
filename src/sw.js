/* 2qo service worker: full offline app shell + cached on-device model runtime. */
import { precacheAndRoute, cleanupOutdatedCaches, createHandlerBoundToURL } from 'workbox-precaching';
import { registerRoute, NavigationRoute } from 'workbox-routing';
import { CacheFirst, StaleWhileRevalidate } from 'workbox-strategies';
import { ExpirationPlugin } from 'workbox-expiration';

self.skipWaiting();
self.addEventListener('activate', (e) => e.waitUntil(self.clients.claim()));

precacheAndRoute(self.__WB_MANIFEST);
cleanupOutdatedCaches();

// every in-app URL boots the cached shell (except hub/API endpoints)
registerRoute(new NavigationRoute(createHandlerBoundToURL('/index.html'), { denylist: [/^\/hub/, /^\/api\//] }));

// WebLLM runtime from CDN — cache forever so the local model works offline after first load
registerRoute(({ url }) => ['esm.run', 'cdn.jsdelivr.net'].includes(url.hostname), new CacheFirst({ cacheName: '2qo-ai-runtime', plugins: [new ExpirationPlugin({ maxEntries: 80 })] }));

// map tiles / misc images opportunistically cached
registerRoute(({ request }) => request.destination === 'image', new StaleWhileRevalidate({ cacheName: '2qo-images', plugins: [new ExpirationPlugin({ maxEntries: 200, maxAgeSeconds: 30 * 86400 })] }));

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const chatId = event.notification.data?.chatId;
  event.waitUntil(
    (async () => {
      const all = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
      const client = all[0];
      if (client) {
        await client.focus();
        client.postMessage({ type: 'open-chat', chatId });
      } else await self.clients.openWindow('/?chat=' + encodeURIComponent(chatId || ''));
    })(),
  );
});
