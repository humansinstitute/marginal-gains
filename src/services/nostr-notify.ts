/**
 * Nostr Task Notification Service
 *
 * Publishes NIP-44 encrypted kind 9802 events when tasks are assigned.
 * The assignee (who could be Wingman or any Nostr user) can decrypt
 * and act on the notification.
 */

import { finalizeEvent, nip19, nip44 } from "nostr-tools";
import { SimplePool } from "nostr-tools/pool";

import { getWingmanIdentity, MG_BASE_URL, NOSTR_RELAYS } from "../config";

export async function publishTaskAssignment(params: {
  assigneeNpub: string;
  teamSlug: string;
  taskId: number;
  taskTitle: string;
  taskDescription: string;
  workingDirectory?: string;
}): Promise<void> {
  const identity = getWingmanIdentity();
  if (!identity) {
    console.warn("[Nostr] Cannot publish task assignment: no WINGMAN_KEY configured");
    return;
  }

  // Decode assignee npub to hex pubkey
  let assigneePubkeyHex: string;
  try {
    const decoded = nip19.decode(params.assigneeNpub);
    if (decoded.type !== "npub") {
      console.error("[Nostr] Invalid assignee npub:", params.assigneeNpub);
      return;
    }
    assigneePubkeyHex = decoded.data as string;
  } catch (err) {
    console.error("[Nostr] Failed to decode assignee npub:", err);
    return;
  }

  // Build payload
  const payload = JSON.stringify({
    type: "task_assigned",
    taskUrl: `${MG_BASE_URL}/t/${params.teamSlug}/todo/kanban?task=${params.taskId}`,
    taskId: params.taskId,
    teamSlug: params.teamSlug,
    title: params.taskTitle,
    description: (params.taskDescription || "").slice(0, 2000),
    ...(params.workingDirectory ? { workingDirectory: params.workingDirectory } : {}),
  });

  // NIP-44 encrypt: derive conversation key, then encrypt
  const conversationKey = nip44.v2.utils.getConversationKey(identity.secretKey, assigneePubkeyHex);
  const ciphertext = nip44.v2.encrypt(payload, conversationKey);

  // Create and sign the kind 9802 event
  const eventTemplate = {
    kind: 9802,
    created_at: Math.floor(Date.now() / 1000),
    tags: [["p", assigneePubkeyHex]],
    content: ciphertext,
  };

  const signedEvent = finalizeEvent(eventTemplate, identity.secretKey);

  // Publish to relays (fire-and-forget)
  const pool = new SimplePool();
  try {
    const publishPromises = pool.publish(NOSTR_RELAYS, signedEvent);
    const results = await Promise.allSettled(publishPromises);
    const succeeded = results.filter((r) => r.status === "fulfilled").length;
    console.log(
      `[Nostr] Published task assignment for "${params.taskTitle}" to ${succeeded}/${NOSTR_RELAYS.length} relays`
    );
  } catch (err) {
    console.error("[Nostr] Failed to publish task assignment:", err);
  } finally {
    pool.close(NOSTR_RELAYS);
  }
}
