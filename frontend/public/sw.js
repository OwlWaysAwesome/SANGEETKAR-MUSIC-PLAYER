self.addEventListener('install', (event) => {
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(clients.claim());
});

self.addEventListener('fetch', (event) => {
  if (event.request.url.includes('/api/stream/')) {
    const newHeaders = new Headers(event.request.headers);
    newHeaders.set('ngrok-skip-browser-warning', 'true');

    const newRequest = new Request(event.request, {
      headers: newHeaders,
      mode: 'cors',
      credentials: 'omit'
    });

    event.respondWith(fetch(newRequest));
  }
});
