import {
  createChannel,
  createEncryptedChannel,
  createEncryptedMessage,
  createMessage,
  getChannel,
  getChannelByName,
  getMessage,
  listChannels,
  listMessages,
  listThreadMessages,
  updateChannel,
} from "../db";

import type { Channel, Message } from "../db";

export function getAllChannels() {
  return listChannels();
}

export function getChannelById(id: number) {
  return getChannel(id);
}

export function findOrCreateChannel(
  name: string,
  displayName: string,
  description: string,
  creator: string,
  isPublic: boolean
): Channel | null {
  const existing = getChannelByName(name);
  if (existing) return existing;
  return createChannel(name, displayName, description, creator, isPublic);
}

export function createNewChannel(
  name: string,
  displayName: string,
  description: string,
  creator: string,
  isPublic: boolean,
  encrypted: boolean = false
): Channel | null {
  const existing = getChannelByName(name);
  if (existing) return null; // Channel name already taken

  if (encrypted) {
    return createEncryptedChannel(name, displayName, description, creator, isPublic);
  }
  return createChannel(name, displayName, description, creator, isPublic);
}

export function editChannel(
  id: number,
  displayName: string,
  description: string,
  isPublic: boolean
): Channel | null {
  return updateChannel(id, displayName, description, isPublic);
}

export function getChannelMessages(channelId: number) {
  return listMessages(channelId);
}

export function getThreadMessages(rootId: number) {
  return listThreadMessages(rootId);
}

export function sendMessage(
  channelId: number,
  author: string,
  body: string,
  parentId: number | null = null
): Message | null {
  if (!body.trim()) return null;

  const channel = getChannel(channelId);
  if (!channel) return null;

  // Determine thread_root_id based on parent
  let threadRootId: number | null = null;
  if (parentId) {
    const parent = getMessage(parentId);
    if (parent) {
      // If parent is already in a thread, use that thread's root
      // Otherwise, the parent becomes the root
      threadRootId = parent.thread_root_id ?? parent.id;
    }
  }

  return createMessage(channelId, author, body.trim(), threadRootId, parentId, null);
}

export function replyToMessage(
  channelId: number,
  author: string,
  body: string,
  parentId: number
): Message | null {
  return sendMessage(channelId, author, body, parentId);
}

export function sendEncryptedMessage(
  channelId: number,
  author: string,
  encryptedBody: string,
  parentId: number | null = null,
  keyVersion: number = 1
): Message | null {
  if (!encryptedBody) return null;

  const channel = getChannel(channelId);
  if (!channel) return null;

  // Determine thread_root_id based on parent
  let threadRootId: number | null = null;
  if (parentId) {
    const parent = getMessage(parentId);
    if (parent) {
      threadRootId = parent.thread_root_id ?? parent.id;
    }
  }

  return createEncryptedMessage(channelId, author, encryptedBody, threadRootId, parentId, null, keyVersion);
}
