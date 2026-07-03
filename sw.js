self.addEventListener('push', function(event) {
  let data = {};
  try {
    data = event.data.json();
  } catch (e) {
    data = { title: 'New message', body: 'You have a new message' };
  }

  const title = data.title || 'New message';
  const options = {
    body: data.body || '',
    data: data,
    icon: '/favicon.ico',
    badge: '/favicon.ico'
  };

  event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener('notificationclick', function(event) {
  event.notification.close();
  const threadId = event.notification.data && event.notification.data.threadId;
  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then(function(clientList) {
      if (clientList.length > 0) {
        const client = clientList[0];
        if (threadId) {
          client.postMessage({ type: 'open-thread', threadId });
        }
        return client.focus();
      }
      return clients.openWindow('/');
    })
  );
});