# Push Notifications Implementation Plan

## Overview

This document describes the implementation of web push notifications for the Marginal Gains PWA. The implementation reuses existing packages (`nostr-tools`, `bun:sqlite`) and follows the established codebase patterns.

**Target Platforms**: iOS Safari 16.4+ (PWA only), Android Chrome/Firefox, Desktop browsers

---

## 1. Install Dependencies

Add `web-push` for server-side push notification handling:

```bash
bun add web-push
bun add -D @types/web-push
```

---

## 2. Database Schema

Add to `src/db.ts` after existing table definitions:

```typescript
// Push notification subscriptions
db.run(`
  CREATE TABLE IF NOT EXISTS push_subscriptions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    npub TEXT NOT NULL,
    endpoint TEXT NOT NULL UNIQUE,
    p256dh_key TEXT NOT NULL,
    auth_key TEXT NOT NULL,
    frequency TEXT NOT NULL DEFAULT 'on_update',
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    last_sent_at TEXT,
    is_active INTEGER DEFAULT 1,
    UNIQUE(npub, endpoint)
  )
`);
db.run("CREATE INDEX IF NOT EXISTS idx_push_subs_npub ON push_subscriptions(npub)");
db.run("CREATE INDEX IF NOT EXISTS idx_push_subs_active ON push_subscriptions(is_active, frequency)");

// VAPID keys (singleton table)
db.run(`
  CREATE TABLE IF NOT EXISTS vapid_config (
    id INTEGER PRIMARY KEY CHECK (id = 1),
    public_key TEXT NOT NULL,
    private_key TEXT NOT NULL,
    contact_email TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  )
`);
```

---

## 3. Types

Add to `src/types.ts`:

```typescript
export type NotificationFrequency = "hourly" | "daily" | "on_update";

export type PushSubscription = {
  id: number;
  npub: string;
  endpoint: string;
  p256dh_key: string;
  auth_key: string;
  frequency: NotificationFrequency;
  created_at: string;
  last_sent_at: string | null;
  is_active: number;
};

export type VapidConfig = {
  id: number;
  public_key: string;
  private_key: string;
  contact_email: string;
  created_at: string;
};

export type NotificationPayload = {
  title: string;
  body: string;
  icon?: string;
  badge?: string;
  url?: string;
  data?: Record<string, unknown>;
};
```

---

## 4. Database Functions

Add to `src/db.ts`:

```typescript
import type { NotificationFrequency, PushSubscription, VapidConfig } from "./types";

// VAPID statements
const getVapidConfigStmt = db.query<VapidConfig>(
  "SELECT * FROM vapid_config WHERE id = 1"
);
const insertVapidConfigStmt = db.query<VapidConfig>(
  `INSERT INTO vapid_config (id, public_key, private_key, contact_email)
   VALUES (1, ?, ?, ?)
   RETURNING *`
);

// Push subscription statements
const getPushSubByEndpointStmt = db.query<PushSubscription>(
  "SELECT * FROM push_subscriptions WHERE endpoint = ?"
);
const getPushSubsForNpubStmt = db.query<PushSubscription>(
  "SELECT * FROM push_subscriptions WHERE npub = ? AND is_active = 1"
);
const getActivePushSubsStmt = db.query<PushSubscription>(
  "SELECT * FROM push_subscriptions WHERE is_active = 1"
);
const getActivePushSubsByFreqStmt = db.query<PushSubscription>(
  "SELECT * FROM push_subscriptions WHERE is_active = 1 AND frequency = ?"
);
const upsertPushSubStmt = db.query<PushSubscription>(
  `INSERT INTO push_subscriptions (npub, endpoint, p256dh_key, auth_key, frequency)
   VALUES (?, ?, ?, ?, ?)
   ON CONFLICT(npub, endpoint) DO UPDATE SET
     p256dh_key = excluded.p256dh_key,
     auth_key = excluded.auth_key,
     frequency = excluded.frequency,
     is_active = 1
   RETURNING *`
);
const updatePushSubFreqStmt = db.query<PushSubscription>(
  `UPDATE push_subscriptions SET frequency = ? WHERE npub = ? AND endpoint = ? RETURNING *`
);
const deactivatePushSubStmt = db.query(
  "UPDATE push_subscriptions SET is_active = 0 WHERE endpoint = ?"
);
const updatePushSubLastSentStmt = db.query(
  "UPDATE push_subscriptions SET last_sent_at = CURRENT_TIMESTAMP WHERE id = ?"
);

// VAPID functions
export function getVapidConfig() {
  return getVapidConfigStmt.get() as VapidConfig | undefined ?? null;
}

export function createVapidConfig(publicKey: string, privateKey: string, contactEmail: string) {
  return insertVapidConfigStmt.get(publicKey, privateKey, contactEmail) as VapidConfig | undefined ?? null;
}

// Push subscription functions
export function getPushSubscriptionByEndpoint(endpoint: string) {
  return getPushSubByEndpointStmt.get(endpoint) as PushSubscription | undefined ?? null;
}

export function getPushSubscriptionsForUser(npub: string) {
  return getPushSubsForNpubStmt.all(npub);
}

export function getActivePushSubscriptions(frequency?: NotificationFrequency) {
  if (frequency) {
    return getActivePushSubsByFreqStmt.all(frequency);
  }
  return getActivePushSubsStmt.all();
}

export function upsertPushSubscription(
  npub: string,
  endpoint: string,
  p256dhKey: string,
  authKey: string,
  frequency: NotificationFrequency
) {
  return upsertPushSubStmt.get(npub, endpoint, p256dhKey, authKey, frequency) as PushSubscription | undefined ?? null;
}

export function updatePushSubscriptionFrequency(npub: string, endpoint: string, frequency: NotificationFrequency) {
  return updatePushSubFreqStmt.get(frequency, npub, endpoint) as PushSubscription | undefined ?? null;
}

export function deactivatePushSubscription(endpoint: string) {
  deactivatePushSubStmt.run(endpoint);
}

export function markPushSubscriptionSent(id: number) {
  updatePushSubLastSentStmt.run(id);
}
```

---

## 5. Push Notification Service

Create `src/services/push.ts`:

```typescript
import webpush from "web-push";

import {
  createVapidConfig,
  deactivatePushSubscription,
  getActivePushSubscriptions,
  getPushSubscriptionsForUser,
  getVapidConfig,
  markPushSubscriptionSent,
  upsertPushSubscription,
} from "../db";
import type { NotificationFrequency, NotificationPayload, PushSubscription } from "../types";

let initialized = false;

export async function initPushService(contactEmail: string): Promise<string> {
  let config = getVapidConfig();

  if (!config) {
    const keys = webpush.generateVAPIDKeys();
    config = createVapidConfig(keys.publicKey, keys.privateKey, contactEmail);
    if (!config) {
      throw new Error("Failed to create VAPID config");
    }
  }

  webpush.setVapidDetails(
    `mailto:${contactEmail}`,
    config.public_key,
    config.private_key
  );

  initialized = true;
  return config.public_key;
}

export function getVapidPublicKey(): string {
  const config = getVapidConfig();
  if (!config) {
    throw new Error("VAPID not initialized");
  }
  return config.public_key;
}

export function subscribePush(
  npub: string,
  endpoint: string,
  p256dhKey: string,
  authKey: string,
  frequency: NotificationFrequency
) {
  return upsertPushSubscription(npub, endpoint, p256dhKey, authKey, frequency);
}

async function sendToSubscription(
  sub: PushSubscription,
  payload: NotificationPayload
): Promise<boolean> {
  try {
    await webpush.sendNotification(
      {
        endpoint: sub.endpoint,
        keys: {
          p256dh: sub.p256dh_key,
          auth: sub.auth_key,
        },
      },
      JSON.stringify(payload)
    );
    markPushSubscriptionSent(sub.id);
    return true;
  } catch (error: unknown) {
    const statusCode = (error as { statusCode?: number }).statusCode;
    // Handle expired/invalid subscriptions
    if (statusCode === 410 || statusCode === 404) {
      deactivatePushSubscription(sub.endpoint);
    }
    console.error("[Push] Failed to send notification:", error);
    return false;
  }
}

export async function sendNotificationToUser(
  npub: string,
  payload: NotificationPayload
): Promise<{ sent: number; failed: number }> {
  const subscriptions = getPushSubscriptionsForUser(npub);
  let sent = 0;
  let failed = 0;

  for (const sub of subscriptions) {
    const success = await sendToSubscription(sub, payload);
    if (success) sent++;
    else failed++;
  }

  return { sent, failed };
}

export async function sendBulkNotifications(
  frequency: NotificationFrequency,
  payload: NotificationPayload
): Promise<{ sent: number; failed: number }> {
  const subscriptions = getActivePushSubscriptions(frequency);
  let sent = 0;
  let failed = 0;

  for (const sub of subscriptions) {
    const success = await sendToSubscription(sub, payload);
    if (success) sent++;
    else failed++;
  }

  return { sent, failed };
}

// For on_update notifications (e.g., new messages, todo changes)
export async function notifyOnUpdate(
  npub: string,
  payload: NotificationPayload
): Promise<void> {
  const subscriptions = getPushSubscriptionsForUser(npub);
  const onUpdateSubs = subscriptions.filter((s) => s.frequency === "on_update");

  for (const sub of onUpdateSubs) {
    await sendToSubscription(sub, payload);
  }
}
```

---

## 6. Push Routes

Create `src/routes/push.ts`:

```typescript
import { jsonResponse } from "../http";
import {
  deactivatePushSubscription,
  getPushSubscriptionsForUser,
  updatePushSubscriptionFrequency,
} from "../db";
import {
  getVapidPublicKey,
  sendNotificationToUser,
  subscribePush,
} from "../services/push";
import type { NotificationFrequency, Session } from "../types";

export function handleGetVapidPublicKey() {
  try {
    const publicKey = getVapidPublicKey();
    return jsonResponse({ publicKey });
  } catch {
    return jsonResponse({ error: "VAPID not initialized" }, 500);
  }
}

export async function handlePushSubscribe(req: Request, session: Session | null) {
  if (!session) {
    return jsonResponse({ error: "Not authenticated" }, 401);
  }

  try {
    const body = await req.json() as {
      subscription: { endpoint: string; keys: { p256dh: string; auth: string } };
      frequency: NotificationFrequency;
    };

    const { subscription, frequency } = body;

    if (!subscription?.endpoint || !subscription?.keys?.p256dh || !subscription?.keys?.auth) {
      return jsonResponse({ error: "Invalid subscription data" }, 400);
    }

    if (!["hourly", "daily", "on_update"].includes(frequency)) {
      return jsonResponse({ error: "Invalid frequency" }, 400);
    }

    const result = subscribePush(
      session.npub,
      subscription.endpoint,
      subscription.keys.p256dh,
      subscription.keys.auth,
      frequency
    );

    if (!result) {
      return jsonResponse({ error: "Failed to save subscription" }, 500);
    }

    return jsonResponse({ success: true });
  } catch {
    return jsonResponse({ error: "Invalid request body" }, 400);
  }
}

export async function handlePushUpdateFrequency(req: Request, session: Session | null) {
  if (!session) {
    return jsonResponse({ error: "Not authenticated" }, 401);
  }

  try {
    const { endpoint, frequency } = await req.json() as {
      endpoint: string;
      frequency: NotificationFrequency;
    };

    if (!endpoint || !["hourly", "daily", "on_update"].includes(frequency)) {
      return jsonResponse({ error: "Invalid request" }, 400);
    }

    const result = updatePushSubscriptionFrequency(session.npub, endpoint, frequency);
    if (!result) {
      return jsonResponse({ error: "Subscription not found" }, 404);
    }

    return jsonResponse({ success: true });
  } catch {
    return jsonResponse({ error: "Invalid request body" }, 400);
  }
}

export async function handlePushUnsubscribe(req: Request, session: Session | null) {
  if (!session) {
    return jsonResponse({ error: "Not authenticated" }, 401);
  }

  try {
    const { endpoint } = await req.json() as { endpoint: string };

    if (!endpoint) {
      return jsonResponse({ error: "Missing endpoint" }, 400);
    }

    deactivatePushSubscription(endpoint);
    return jsonResponse({ success: true });
  } catch {
    return jsonResponse({ error: "Invalid request body" }, 400);
  }
}

export function handleGetPushStatus(session: Session | null) {
  if (!session) {
    return jsonResponse({ error: "Not authenticated" }, 401);
  }

  const subscriptions = getPushSubscriptionsForUser(session.npub);
  return jsonResponse({
    subscribed: subscriptions.length > 0,
    subscriptions: subscriptions.map((s) => ({
      endpoint: s.endpoint,
      frequency: s.frequency,
      createdAt: s.created_at,
    })),
  });
}

// Test notification endpoint (for debugging)
export async function handleSendTestNotification(session: Session | null) {
  if (!session) {
    return jsonResponse({ error: "Not authenticated" }, 401);
  }

  const result = await sendNotificationToUser(session.npub, {
    title: "Test Notification",
    body: "Push notifications are working!",
    icon: "/icon-192.png",
    url: "/",
  });

  return jsonResponse(result);
}
```

---

## 7. Server Integration

Update `src/server.ts` to add push routes:

```typescript
// Add imports
import {
  handleGetPushStatus,
  handleGetVapidPublicKey,
  handlePushSubscribe,
  handlePushUnsubscribe,
  handlePushUpdateFrequency,
  handleSendTestNotification,
} from "./routes/push";
import { initPushService } from "./services/push";

// Initialize push service before server starts
const CONTACT_EMAIL = Bun.env.PUSH_CONTACT_EMAIL || "admin@example.com";
await initPushService(CONTACT_EMAIL);

// Add to GET routes:
if (pathname === "/api/push/vapid-public-key") return handleGetVapidPublicKey();
if (pathname === "/api/push/status") return handleGetPushStatus(session);

// Add to POST routes:
if (pathname === "/api/push/subscribe") return handlePushSubscribe(req, session);
if (pathname === "/api/push/unsubscribe") return handlePushUnsubscribe(req, session);
if (pathname === "/api/push/test") return handleSendTestNotification(session);

// Add to PATCH routes:
if (pathname === "/api/push/frequency") return handlePushUpdateFrequency(req, session);
```

---

## 8. Service Worker

Create `public/sw.js`:

```javascript
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

  event.waitUntil(
    self.registration.showNotification(data.title, options)
  );
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
      return cache.addAll([
        "/icon-192.png",
        "/icon-512.png",
      ]);
    })
  );
  self.skipWaiting();
});

// Activate event - clean old caches
self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((cacheNames) => {
      return Promise.all(
        cacheNames
          .filter((name) => name !== CACHE_NAME)
          .map((name) => caches.delete(name))
      );
    })
  );
  self.clients.claim();
});
```

---

## 9. Frontend Push Manager

Create `public/push.js`:

```javascript
// Push notification manager for the frontend
let swRegistration = null;
let vapidPublicKey = null;

// Convert base64 VAPID key to Uint8Array
function urlBase64ToUint8Array(base64String) {
  const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/");
  const rawData = window.atob(base64);
  const outputArray = new Uint8Array(rawData.length);
  for (let i = 0; i < rawData.length; i++) {
    outputArray[i] = rawData.charCodeAt(i);
  }
  return outputArray;
}

// Check if push notifications are supported
export function isPushSupported() {
  // Check basic support
  if (!("serviceWorker" in navigator) || !("PushManager" in window) || !("Notification" in window)) {
    return false;
  }

  // iOS requires standalone mode (added to home screen)
  const isIOS = /iPhone|iPad|iPod/.test(navigator.userAgent);
  const isStandalone = window.matchMedia("(display-mode: standalone)").matches;

  if (isIOS && !isStandalone) {
    return false;
  }

  return true;
}

// Initialize push manager
export async function initPush() {
  if (!isPushSupported()) {
    console.log("[Push] Not supported on this device/browser");
    return false;
  }

  try {
    // Register service worker
    swRegistration = await navigator.serviceWorker.register("/sw.js");
    console.log("[Push] Service worker registered");

    // Fetch VAPID public key
    const res = await fetch("/api/push/vapid-public-key");
    if (!res.ok) {
      throw new Error("Failed to fetch VAPID key");
    }
    const data = await res.json();
    vapidPublicKey = data.publicKey;

    return true;
  } catch (err) {
    console.error("[Push] Init failed:", err);
    return false;
  }
}

// Get current subscription
export async function getCurrentSubscription() {
  if (!swRegistration) return null;
  return await swRegistration.pushManager.getSubscription();
}

// Request permission and subscribe
export async function subscribeToPush(frequency = "on_update") {
  if (!swRegistration || !vapidPublicKey) {
    throw new Error("Push not initialized");
  }

  // Request permission
  const permission = await Notification.requestPermission();
  if (permission !== "granted") {
    throw new Error("Notification permission denied");
  }

  // Subscribe to push
  const subscription = await swRegistration.pushManager.subscribe({
    userVisibleOnly: true,
    applicationServerKey: urlBase64ToUint8Array(vapidPublicKey),
  });

  // Send to server
  const res = await fetch("/api/push/subscribe", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      subscription: subscription.toJSON(),
      frequency,
    }),
  });

  if (!res.ok) {
    throw new Error("Failed to save subscription");
  }

  return subscription;
}

// Update notification frequency
export async function updateFrequency(frequency) {
  const subscription = await getCurrentSubscription();
  if (!subscription) {
    // Not subscribed, do full subscription
    return await subscribeToPush(frequency);
  }

  const res = await fetch("/api/push/frequency", {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      endpoint: subscription.endpoint,
      frequency,
    }),
  });

  if (!res.ok) {
    throw new Error("Failed to update frequency");
  }

  return subscription;
}

// Unsubscribe from push
export async function unsubscribeFromPush() {
  const subscription = await getCurrentSubscription();
  if (!subscription) return true;

  // Unsubscribe from browser
  await subscription.unsubscribe();

  // Notify server
  await fetch("/api/push/unsubscribe", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ endpoint: subscription.endpoint }),
  });

  return true;
}

// Get current status from server
export async function getPushStatus() {
  const res = await fetch("/api/push/status");
  if (!res.ok) return null;
  return await res.json();
}

// Send test notification
export async function sendTestNotification() {
  const res = await fetch("/api/push/test", { method: "POST" });
  return await res.json();
}
```

---

## 10. Settings UI Component

Create `public/notifications.js`:

```javascript
import { elements as el, hide, show, escapeHtml } from "./dom.js";
import {
  initPush,
  isPushSupported,
  subscribeToPush,
  unsubscribeFromPush,
  updateFrequency,
  getCurrentSubscription,
  getPushStatus,
  sendTestNotification,
} from "./push.js";

let currentFrequency = null;
let isSubscribed = false;
let isSupported = false;

export async function initNotifications() {
  const container = document.querySelector("[data-notifications-section]");
  if (!container) return;

  isSupported = isPushSupported();

  if (!isSupported) {
    renderUnsupported(container);
    return;
  }

  const initialized = await initPush();
  if (!initialized) {
    renderUnsupported(container);
    return;
  }

  // Check current status
  const subscription = await getCurrentSubscription();
  isSubscribed = !!subscription;

  if (isSubscribed) {
    const status = await getPushStatus();
    if (status?.subscriptions?.length > 0) {
      currentFrequency = status.subscriptions[0].frequency;
    }
  }

  renderNotificationSettings(container);
  wireNotificationListeners(container);
}

function renderUnsupported(container) {
  const isIOS = /iPhone|iPad|iPod/.test(navigator.userAgent);
  const isStandalone = window.matchMedia("(display-mode: standalone)").matches;

  let message = "Push notifications are not supported on this device.";
  if (isIOS && !isStandalone) {
    message = "To enable notifications on iOS, add this app to your home screen first.";
  }

  container.innerHTML = `
    <div class="settings-section-header">
      <h2>Notifications</h2>
    </div>
    <div class="notification-unsupported">
      <p>${escapeHtml(message)}</p>
    </div>
  `;
}

function renderNotificationSettings(container) {
  const frequencyOptions = [
    { value: "on_update", label: "Every update", description: "Get notified immediately when something changes" },
    { value: "hourly", label: "Hourly summary", description: "Receive a summary every hour" },
    { value: "daily", label: "Daily digest", description: "Get one notification per day with your summary" },
  ];

  container.innerHTML = `
    <div class="settings-section-header">
      <h2>Notifications</h2>
      ${isSubscribed ? `<button type="button" class="ghost" data-test-notification>Test</button>` : ""}
    </div>
    <div class="notification-options">
      ${frequencyOptions
        .map(
          (opt) => `
        <label class="notification-option ${currentFrequency === opt.value ? "selected" : ""}">
          <input
            type="radio"
            name="notification-frequency"
            value="${opt.value}"
            ${currentFrequency === opt.value ? "checked" : ""}
          />
          <div class="notification-option-content">
            <span class="notification-option-label">${escapeHtml(opt.label)}</span>
            <span class="notification-option-desc">${escapeHtml(opt.description)}</span>
          </div>
        </label>
      `
        )
        .join("")}
    </div>
    ${
      isSubscribed
        ? `<button type="button" class="ghost notification-disable" data-disable-notifications>
            Disable notifications
          </button>`
        : ""
    }
    <p class="notification-status" data-notification-status hidden></p>
  `;
}

function wireNotificationListeners(container) {
  // Frequency selection
  container.querySelectorAll('input[name="notification-frequency"]').forEach((radio) => {
    radio.addEventListener("change", async (e) => {
      const frequency = e.target.value;
      await handleFrequencyChange(container, frequency);
    });
  });

  // Disable button
  const disableBtn = container.querySelector("[data-disable-notifications]");
  disableBtn?.addEventListener("click", async () => {
    await handleDisable(container);
  });

  // Test button
  const testBtn = container.querySelector("[data-test-notification]");
  testBtn?.addEventListener("click", async () => {
    await handleTest(container);
  });
}

async function handleFrequencyChange(container, frequency) {
  const statusEl = container.querySelector("[data-notification-status]");

  try {
    show(statusEl);
    statusEl.textContent = "Updating...";
    statusEl.className = "notification-status";

    if (isSubscribed) {
      await updateFrequency(frequency);
    } else {
      await subscribeToPush(frequency);
      isSubscribed = true;
    }

    currentFrequency = frequency;
    statusEl.textContent = "Notifications enabled!";
    statusEl.className = "notification-status success";

    // Re-render to show disable button if newly subscribed
    renderNotificationSettings(container);
    wireNotificationListeners(container);
  } catch (err) {
    console.error("[Notifications] Error:", err);
    statusEl.textContent = err.message || "Failed to update notifications";
    statusEl.className = "notification-status error";
  }
}

async function handleDisable(container) {
  const statusEl = container.querySelector("[data-notification-status]");

  try {
    show(statusEl);
    statusEl.textContent = "Disabling...";
    statusEl.className = "notification-status";

    await unsubscribeFromPush();

    isSubscribed = false;
    currentFrequency = null;
    statusEl.textContent = "Notifications disabled";
    statusEl.className = "notification-status";

    // Re-render to remove disable button
    renderNotificationSettings(container);
    wireNotificationListeners(container);
  } catch (err) {
    console.error("[Notifications] Error:", err);
    statusEl.textContent = "Failed to disable notifications";
    statusEl.className = "notification-status error";
  }
}

async function handleTest(container) {
  const statusEl = container.querySelector("[data-notification-status]");

  try {
    show(statusEl);
    statusEl.textContent = "Sending test...";
    statusEl.className = "notification-status";

    const result = await sendTestNotification();
    statusEl.textContent = `Test sent! (${result.sent} delivered, ${result.failed} failed)`;
    statusEl.className = "notification-status success";
  } catch (err) {
    statusEl.textContent = "Failed to send test";
    statusEl.className = "notification-status error";
  }
}
```

---

## 11. Update Settings Page Render

Update `src/render/settings.ts` to include the notifications section:

```typescript
function renderSettingsContent() {
  return `<div class="settings-content">
    <!-- Notifications Section -->
    <section class="settings-section" data-notifications-section>
      <div class="settings-section-header">
        <h2>Notifications</h2>
      </div>
      <p class="settings-empty">Loading...</p>
    </section>

    <!-- Groups Section (existing) -->
    <section class="settings-section">
      <div class="settings-section-header">
        <h2>Groups</h2>
        <button type="button" class="primary" data-create-group>Create Group</button>
      </div>
      ...
    </section>
    ...
  </div>`;
}
```

---

## 12. Update Settings JavaScript

Update `public/settings.js` to initialize notifications:

```javascript
import { initNotifications } from "./notifications.js";

export async function initSettings() {
  if (!window.__SETTINGS_PAGE__) return;

  await Promise.all([
    fetchGroups(),
    fetchUsers(),
    initNotifications(),  // Add this
  ]);
  renderGroups();
  wireEventListeners();
}
```

---

## 13. CSS Styles

Add to `public/app.css`:

```css
/* Notification Settings */
.notification-options {
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
}

.notification-option {
  display: flex;
  align-items: flex-start;
  gap: 0.75rem;
  padding: 0.75rem;
  border: 1px solid var(--border-color, #ddd);
  border-radius: 8px;
  cursor: pointer;
  transition: border-color 0.15s, background-color 0.15s;
}

.notification-option:hover {
  border-color: var(--primary-color, #6b3a6b);
}

.notification-option.selected {
  border-color: var(--primary-color, #6b3a6b);
  background-color: var(--primary-bg, #f9f5f9);
}

.notification-option input[type="radio"] {
  margin-top: 0.25rem;
}

.notification-option-content {
  display: flex;
  flex-direction: column;
  gap: 0.25rem;
}

.notification-option-label {
  font-weight: 500;
}

.notification-option-desc {
  font-size: 0.875rem;
  color: var(--text-muted, #666);
}

.notification-disable {
  margin-top: 1rem;
  color: var(--danger-color, #dc3545);
}

.notification-status {
  margin-top: 0.75rem;
  padding: 0.5rem;
  border-radius: 4px;
  font-size: 0.875rem;
}

.notification-status.success {
  background-color: var(--success-bg, #d4edda);
  color: var(--success-color, #155724);
}

.notification-status.error {
  background-color: var(--danger-bg, #f8d7da);
  color: var(--danger-color, #721c24);
}

.notification-unsupported {
  padding: 1rem;
  background-color: var(--warning-bg, #fff3cd);
  border-radius: 8px;
  color: var(--warning-color, #856404);
}
```

---

## 14. Update Config

Add to `src/config.ts`:

```typescript
export const PUSH_CONTACT_EMAIL = Bun.env.PUSH_CONTACT_EMAIL || "admin@example.com";
```

---

## 15. Update Manifest

Update `public/manifest.webmanifest` to include notification-related fields:

```json
{
  "name": "Marginal Gains",
  "short_name": "MG",
  "description": "Track your daily marginal gains",
  "start_url": "/",
  "display": "standalone",
  "background_color": "#f4f4f4",
  "theme_color": "#6b3a6b",
  "orientation": "portrait",
  "icons": [
    {
      "src": "/icon-192.png",
      "sizes": "192x192",
      "type": "image/png"
    },
    {
      "src": "/icon-512.png",
      "sizes": "512x512",
      "type": "image/png"
    },
    {
      "src": "/apple-touch-icon.png",
      "sizes": "180x180",
      "type": "image/png",
      "purpose": "any"
    }
  ]
}
```

---

## 16. Triggering Notifications (Integration Points)

### On New Message (in `src/routes/chat.ts`):

```typescript
import { notifyOnUpdate } from "../services/push";

// In handleSendMessage, after creating the message:
// Notify mentioned users
if (mentionedNpubs.length > 0) {
  for (const npub of mentionedNpubs) {
    await notifyOnUpdate(npub, {
      title: "New mention",
      body: `${authorName} mentioned you in ${channelName}`,
      url: `/chat?channel=${channelId}`,
    });
  }
}
```

### Scheduled Notifications (Hourly/Daily)

Create `src/jobs/notifications.ts`:

```typescript
import { sendBulkNotifications } from "../services/push";

export function startNotificationJobs() {
  // Hourly job
  setInterval(async () => {
    const hour = new Date().getHours();
    await sendBulkNotifications("hourly", {
      title: "Hourly Update",
      body: "Check your tasks and messages",
      icon: "/icon-192.png",
      url: "/",
    });
    console.log(`[Jobs] Hourly notifications sent at hour ${hour}`);
  }, 60 * 60 * 1000); // Every hour

  // Daily job (at 9 AM)
  const scheduleDailyJob = () => {
    const now = new Date();
    const next9AM = new Date();
    next9AM.setHours(9, 0, 0, 0);
    if (now >= next9AM) {
      next9AM.setDate(next9AM.getDate() + 1);
    }
    const delay = next9AM.getTime() - now.getTime();

    setTimeout(async () => {
      await sendBulkNotifications("daily", {
        title: "Daily Digest",
        body: "Here's your daily summary",
        icon: "/icon-192.png",
        url: "/",
      });
      console.log("[Jobs] Daily notifications sent");
      scheduleDailyJob(); // Schedule next day
    }, delay);
  };

  scheduleDailyJob();
}
```

Add to `src/server.ts`:

```typescript
import { startNotificationJobs } from "./jobs/notifications";

// After server starts
startNotificationJobs();
```

---

## 17. Environment Variables

Add to `.env` or environment:

```bash
PUSH_CONTACT_EMAIL=your@email.com
```

---

## 18. Testing Checklist

### iOS Testing
- [ ] App served over HTTPS (required for service workers)
- [ ] User adds PWA to home screen
- [ ] Opens from home screen (standalone mode)
- [ ] Permission prompt appears on frequency selection
- [ ] Test notification received
- [ ] Notification click opens app to correct URL

### Android/Desktop Testing
- [ ] Service worker registers successfully
- [ ] Permission prompt appears
- [ ] Test notification works
- [ ] Frequency changes saved
- [ ] Disable button works
- [ ] Notifications appear when app is closed

### Database Testing
- [ ] VAPID keys persisted across restarts
- [ ] Subscriptions stored correctly
- [ ] Frequency updates work
- [ ] Deactivation marks `is_active = 0`

---

## 19. File Summary

| File | Purpose |
|------|---------|
| `src/db.ts` | Add push tables and functions |
| `src/types.ts` | Add notification types |
| `src/services/push.ts` | Core push notification logic |
| `src/routes/push.ts` | API endpoints |
| `src/jobs/notifications.ts` | Scheduled jobs |
| `src/server.ts` | Route wiring, init |
| `public/sw.js` | Service worker |
| `public/push.js` | Frontend push manager |
| `public/notifications.js` | Settings UI component |
| `public/settings.js` | Init notifications |
| `src/render/settings.ts` | Add notifications section |
| `public/app.css` | Notification styles |

---

## 20. Security Considerations

1. **VAPID keys**: Generated once, stored in database, never exposed publicly (only public key sent to clients)
2. **Endpoint validation**: Only authenticated users can subscribe/modify
3. **Rate limiting**: Consider adding rate limits to prevent notification spam
4. **Subscription cleanup**: Expired subscriptions automatically deactivated on 410/404 responses
