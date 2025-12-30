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

// Get debug info for troubleshooting
export function getPushDebugInfo() {
  const isSecureContext = window.isSecureContext;
  const protocol = window.location.protocol;
  const hasServiceWorker = "serviceWorker" in navigator;
  const hasPushManager = "PushManager" in window;
  const hasNotification = "Notification" in window;
  const isIOS = /iPhone|iPad|iPod/.test(navigator.userAgent);
  const mediaQueryStandalone = window.matchMedia("(display-mode: standalone)").matches;
  const navigatorStandalone = navigator.standalone;
  const isStandalone = mediaQueryStandalone || navigatorStandalone === true;

  return {
    isSecureContext,
    protocol,
    hasServiceWorker,
    hasPushManager,
    hasNotification,
    isIOS,
    mediaQueryStandalone,
    navigatorStandalone,
    isStandalone,
    userAgent: navigator.userAgent,
  };
}

// Check if push notifications are supported
export function isPushSupported() {
  // Check basic support
  const hasServiceWorker = "serviceWorker" in navigator;
  const hasPushManager = "PushManager" in window;
  const hasNotification = "Notification" in window;

  console.log("[Push] Support check:", { hasServiceWorker, hasPushManager, hasNotification });

  if (!hasServiceWorker || !hasPushManager || !hasNotification) {
    console.log("[Push] Missing basic support");
    return false;
  }

  // iOS requires standalone mode (added to home screen)
  const isIOS = /iPhone|iPad|iPod/.test(navigator.userAgent);
  // Check both media query AND Safari-specific navigator.standalone
  const isStandalone =
    window.matchMedia("(display-mode: standalone)").matches || navigator.standalone === true;

  console.log("[Push] iOS check:", { isIOS, isStandalone, navigatorStandalone: navigator.standalone });

  if (isIOS && !isStandalone) {
    console.log("[Push] iOS detected but not in standalone mode");
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
