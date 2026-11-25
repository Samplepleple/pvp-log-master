// Serves the app's own files offline and refreshes them in the background.
// Everything else (rankings, Pokémon images) goes straight to the network.
// The Great League app lives on the same origin, so only caches starting with "pvpm-" are ours to delete.
const SHELL = 'pvpm-shell-v1', GM = 'pvpm-gm';
const FILES = ['./', 'index.html', 'app.js', 'data.js', 'manifest.webmanifest', 'icon-180.png', 'icon-192.png', 'icon-512.png',
  'engine/worker.js', 'engine/gm-shim.js', 'engine/gamemaster.json', 'engine/Battle.js', 'engine/Pokemon.js', 'engine/ActionLogic.js', 'engine/DamageCalculator.js', 'engine/TimelineAction.js', 'engine/TimelineEvent.js', 'engine/DecisionOption.js'];

const fill = () => caches.open(SHELL).then(c => c.addAll(FILES));

self.addEventListener('install', e => {
  e.waitUntil(fill().then(() => self.skipWaiting()));
});
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys()
    .then(keys => Promise.all(keys.filter(k => k.startsWith('pvpm-') && k !== SHELL && k !== GM).map(k => caches.delete(k))))
    .then(() => self.clients.claim()));
});
self.addEventListener('fetch', e => {
  if (e.request.method !== 'GET' || new URL(e.request.url).origin !== location.origin) return;
  // The Great League app's service worker removes unknown caches when it updates; refill ours on the next open.
  if (e.request.mode === 'navigate') e.waitUntil(caches.has(SHELL).then(has => has || fill()).catch(() => {}));
  e.respondWith(caches.open(SHELL).then(async c => {
    const hit = await c.match(e.request, { ignoreSearch: true });
    const fresh = fetch(e.request).then(res => { if (res.ok) c.put(e.request, res.clone()); return res; });
    if (hit) { e.waitUntil(fresh.catch(() => {})); return hit; }
    return fresh;
  }));
});
