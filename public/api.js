/**
 * API URL Helper for Multi-Tenant Routes
 *
 * Provides helper functions to build team-scoped API URLs.
 * When a team slug is present (from window.__TEAM_SLUG__),
 * URLs are prefixed with /t/{team}/
 */

/**
 * Get the current team slug from the page
 * @returns {string|null} The team slug or null if not in team context
 */
export function getTeamSlug() {
  return window.__TEAM_SLUG__ || null;
}

/**
 * Build a team-scoped URL
 * @param {string} path - The path without team prefix (e.g., "/chat/channels")
 * @returns {string} The full URL with team prefix if applicable
 */
export function teamUrl(path) {
  const teamSlug = getTeamSlug();
  if (teamSlug) {
    return `/t/${teamSlug}${path}`;
  }
  return path;
}

/**
 * Build a chat API URL
 * @param {string} path - The path after /chat (e.g., "/channels" or "/channels/123/messages")
 * @returns {string} The full URL
 */
export function chatUrl(path) {
  return teamUrl(`/chat${path}`);
}

/**
 * Build a channel URL for browser navigation
 * @param {string} channelName - The channel slug/name
 * @returns {string} The URL for navigating to a channel
 */
export function channelUrl(channelName) {
  return teamUrl(`/chat/channel/${encodeURIComponent(channelName)}`);
}

/**
 * Build a DM URL for browser navigation
 * @param {number|string} channelId - The DM channel ID
 * @returns {string} The URL for navigating to a DM
 */
export function dmUrl(channelId) {
  return teamUrl(`/chat/dm/${channelId}`);
}

/**
 * Build the base chat URL for browser navigation
 * @returns {string} The URL for the chat page
 */
export function baseChatUrl() {
  return teamUrl("/chat");
}

/**
 * Build an SSE events URL
 * @returns {string} The URL for the chat events endpoint
 */
export function eventsUrl() {
  return teamUrl("/chat/events");
}

/**
 * Check if currently in a team context
 * @returns {boolean} True if a team is selected
 */
export function hasTeamContext() {
  return !!getTeamSlug();
}

/**
 * Build a CRM API URL
 * @param {string} path - The path after /api/crm (e.g., "/companies" or "/contacts/123")
 * @returns {string} The full URL
 */
export function crmUrl(path) {
  return teamUrl(`/api/crm${path}`);
}

/**
 * Build a tasks API URL
 * @param {string} path - The path after /api (e.g., "/tasks" or "/tasks/123/threads")
 * @returns {string} The full URL
 */
export function tasksUrl(path) {
  return teamUrl(`/api${path}`);
}
