import assert from 'node:assert/strict';

// Keep an old browser bundle alive across a reload while API requests still reach the test server.
export async function reloadWithCachedClient({ server, evaluate, waitFor, reload }, bundlePath) {
  const [serve] = server.listeners('request');
  assert.equal(server.listenerCount('request'), 1);
  const workerPath = '/mixed-version-test-worker.js';
  const worker = `
    const bundle = ${JSON.stringify(bundlePath)};
    const cacheName = 'mixed-version-test-bundle';
    self.addEventListener('install', event => {
      event.waitUntil(caches.open(cacheName).then(cache => cache.add(bundle)).then(() => self.skipWaiting()));
    });
    self.addEventListener('activate', event => event.waitUntil(self.clients.claim()));
    self.addEventListener('fetch', event => {
      if (new URL(event.request.url).pathname === bundle) event.respondWith(caches.match(bundle));
    });
  `;
  let blockNetworkBundle = false;
  let networkBundleRequests = 0;
  function serveWithWorker(request, response) {
    const pathname = new URL(request.url, 'http://127.0.0.1').pathname;
    if (pathname === workerPath) {
      response.setHeader('Content-Type', 'application/javascript');
      response.end(worker);
    } else if (pathname === bundlePath && blockNetworkBundle) {
      networkBundleRequests += 1;
      response.writeHead(503).end('The old bundle is only available through the service worker');
    } else {
      serve.call(server, request, response);
    }
  }

  server.off('request', serve);
  server.on('request', serveWithWorker);
  try {
    await evaluate(`navigator.serviceWorker.register(${JSON.stringify(workerPath)}).then(() => true)`);
    const isControlled = `navigator.serviceWorker.controller?.scriptURL.endsWith(${JSON.stringify(workerPath)}) === true`;
    await waitFor(isControlled);
    blockNetworkBundle = true;
    await reload();
    assert.equal(await evaluate(isControlled), true);
    const bundleUrl = `new URL(${JSON.stringify(bundlePath)}, location.href).href`;
    assert.equal(await evaluate(`performance.getEntriesByName(${bundleUrl}).some(entry => entry.workerStart > 0)`), true);
    assert.equal(networkBundleRequests, 0);
  } finally {
    server.off('request', serveWithWorker);
    server.on('request', serve);
  }
}
