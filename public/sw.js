// Service Worker for Push Notifications
const CACHE_NAME = "mg-v1";

// Push notification handler
self.addEventListener("push", (event) => {
  const defaultPayload = {
    title: "Marginal Gains",
    body: "You have a new notification",
    icon: "/icon-192.png",
    badge: "/icon-192.png",
    url: "/",
  };

  let data = defaultPayload;
  try {
    if (event.data) {
      data = { ...defaultPayload, ...event.data.json() };
    }
  } catch {
    // Use defaults if parsing fails
  }

  const options = {
    body: data.body,
    icon: data.icon,
    badge: data.badge,
    vibrate: [200, 100, 200],
    tag: data.tag || "default",
    data: {
      url: data.url || "/",
      ...data.data,
    },
    requireInteraction: false,
  };

  event.waitUntil(self.registration.showNotification(data.title, options));
});

// Notification click handler
self.addEventListener("notificationclick", (event) => {
  event.notification.close();

  const urlToOpen = event.notification.data?.url || "/";

  event.waitUntil(
    clients.matchAll({ type: "window", includeUncontrolled: true }).then((clientList) => {
      // Focus existing window if found
      for (const client of clientList) {
        if (client.url.includes(self.location.origin) && "focus" in client) {
          client.navigate(urlToOpen);
          return client.focus();
        }
      }
      // Open new window
      if (clients.openWindow) {
        return clients.openWindow(urlToOpen);
      }
    })
  );
});

// Install event - cache essential assets
self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      return cache.addAll(["/icon-192.png", "/icon-512.png"]);
    })
  );
  self.skipWaiting();
});

// Activate event - clean old caches
self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((cacheNames) => {
      return Promise.all(
        cacheNames.filter((name) => name !== CACHE_NAME).map((name) => caches.delete(name))
      );
    })
  );
  self.clients.claim();
});
