/// <reference lib="webworker" />
// Service worker: precaches the app shell so the installed game opens offline, and
// caches 3D models the first time they load (they are too big to download up front).
import { ExpirationPlugin } from 'workbox-expiration';
import { cleanupOutdatedCaches, createHandlerBoundToURL, precacheAndRoute } from 'workbox-precaching';
import { NavigationRoute, registerRoute } from 'workbox-routing';
import { CacheFirst } from 'workbox-strategies';

declare const self: ServiceWorkerGlobalScope;

precacheAndRoute(self.__WB_MANIFEST);
cleanupOutdatedCaches();
registerRoute(new NavigationRoute(createHandlerBoundToURL('/index.html')));
registerRoute(
  ({ url }) => url.pathname.startsWith('/models/') && url.pathname.endsWith('.glb'),
  new CacheFirst({
    cacheName: 'models-v1',
    plugins: [new ExpirationPlugin({ maxEntries: 48, maxAgeSeconds: 180 * 24 * 3600 })],
  }),
);

// The page asks a waiting worker to take over once the player accepts the update.
self.addEventListener('message', (e) => {
  if ((e.data as { type?: string } | null)?.type === 'SKIP_WAITING') void self.skipWaiting();
});
