/// <reference lib="webworker" />
// Service worker: precaches the app shell so the installed game opens offline, and
// caches 3D models the first time they load (they are too big to download up front).
import { ExpirationPlugin } from 'workbox-expiration';
import { cleanupOutdatedCaches, createHandlerBoundToURL, precacheAndRoute } from 'workbox-precaching';
import { NavigationRoute, registerRoute } from 'workbox-routing';
import { StaleWhileRevalidate } from 'workbox-strategies';

declare const self: ServiceWorkerGlobalScope;

precacheAndRoute(self.__WB_MANIFEST);
cleanupOutdatedCaches();
registerRoute(new NavigationRoute(createHandlerBoundToURL('/index.html')));
registerRoute(
  ({ url }) => url.pathname.startsWith('/models/') && url.pathname.endsWith('.glb'),
  // Serve the cached model at once, refresh it in the background for next time.
  new StaleWhileRevalidate({
    cacheName: 'models-v1',
    plugins: [new ExpirationPlugin({ maxEntries: 48, maxAgeSeconds: 180 * 24 * 3600 })],
  }),
);

// The page asks a waiting worker to take over once the player accepts the update.
self.addEventListener('message', (e) => {
  if ((e.data as { type?: string } | null)?.type === 'SKIP_WAITING') void self.skipWaiting();
});

// Push from the notifier function (data-only, so the text and click target are ours).
self.addEventListener('push', (e) => {
  const payload = (e.data?.json() ?? {}) as { data?: Record<string, string> };
  const d = payload.data ?? {};
  e.waitUntil(
    self.registration.showNotification(d.title ?? 'Vườn Chung', {
      body: d.body ?? '',
      icon: '/icon-192.png',
      badge: '/icon-192.png',
      tag: d.tag,
      data: { url: d.url ?? '/' },
    }),
  );
});

// Tapping a notification focuses an open game window, or opens the garden.
self.addEventListener('notificationclick', (e) => {
  e.notification.close();
  const url = (e.notification.data as { url?: string } | null)?.url ?? '/';
  e.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((wins) => {
      const open = wins.find((w) => new URL(w.url).origin === self.location.origin);
      return open ? open.focus() : self.clients.openWindow(url);
    }),
  );
});
