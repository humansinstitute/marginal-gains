import webpush from "web-push";

import {
  createVapidConfig,
  deactivatePushSubscription,
  getActivePushSubscriptions,
  getPushSubscriptionsForUser,
  getVapidConfig,
  markPushSubscriptionSent,
  upsertPushSubscription,
  type PushSubscription,
} from "../db";

import type { NotificationFrequency, NotificationPayload } from "../types";

export function initPushService(contactEmail: string): string {
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

// Notify all users with on_update subscriptions who should receive a channel message
// excludeNpub: typically the sender, who shouldn't get notified of their own message
export async function notifyChannelMessage(
  recipientNpubs: string[] | undefined,
  excludeNpub: string,
  payload: NotificationPayload
): Promise<{ sent: number; failed: number }> {
  // Get all on_update subscriptions
  const allSubs = getActivePushSubscriptions("on_update");

  // Filter to recipients (if specified) and exclude sender
  const eligibleSubs = allSubs.filter((sub) => {
    if (sub.npub === excludeNpub) return false;
    if (recipientNpubs && !recipientNpubs.includes(sub.npub)) return false;
    return true;
  });

  let sent = 0;
  let failed = 0;

  for (const sub of eligibleSubs) {
    const success = await sendToSubscription(sub, payload);
    if (success) sent++;
    else failed++;
  }

  return { sent, failed };
}
