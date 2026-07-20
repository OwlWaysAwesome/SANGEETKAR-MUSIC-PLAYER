self.addEventListener('fetch', (event) => {
  // Only intercept requests to our backend stream API
  if (event.request.url.includes('/api/stream/')) {
    // Clone headers and add ngrok bypass
    const newHeaders = new Headers(event.request.headers);
    newHeaders.set('ngrok-skip-browser-warning', 'true');

    // Create a new request with the updated headers
    const newRequest = new Request(event.request, {
      headers: newHeaders,
      mode: 'cors',
      credentials: 'omit' // No need for cookies since we use bearer tokens
    });

    event.respondWith(fetch(newRequest));
  }
});
