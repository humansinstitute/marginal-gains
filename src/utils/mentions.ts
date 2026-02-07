/**
 * Parse @mentions from plaintext message body
 * Returns array of npub strings
 */
export function parseMentionsFromBody(body: string): string[] {
  const mentions: string[] = [];
  const mentionPattern = /nostr:(npub1[a-z0-9]{58})/gi;
  let match;
  while ((match = mentionPattern.exec(body)) !== null) {
    const npub = match[1].toLowerCase();
    if (!mentions.includes(npub)) {
      mentions.push(npub);
    }
  }
  return mentions;
}
