import {
  deactivatePushSubscription,
  getPushSubscriptionsForUser,
  updatePushSubscriptionFrequency,
} from "../db";
import { jsonResponse } from "../http";
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
