export type TodoState = "new" | "ready" | "in_progress" | "review" | "done" | "archived";
export type TodoPriority = "rock" | "pebble" | "sand";

/**
 * Team membership info attached to session
 */
export type SessionTeamMembership = {
  teamId: number;
  teamSlug: string;
  displayName: string;
  iconUrl?: string | null;
  role: "owner" | "manager" | "member";
};

/**
 * User session with optional team context
 *
 * Team fields are optional for backwards compatibility during migration.
 * Once multi-tenancy is fully deployed, these become required.
 */
export type Session = {
  token: string;
  pubkey: string;
  npub: string;
  method: LoginMethod;
  createdAt: number;
  // Team context (optional during migration)
  currentTeamId?: number | null;
  currentTeamSlug?: string | null;
  teamMemberships?: SessionTeamMembership[];
};

export type LoginMethod = "ephemeral" | "extension" | "bunker" | "secret";

export type NotificationFrequency = "hourly" | "daily" | "on_update";

export type NotificationPayload = {
  title: string;
  body: string;
  icon?: string;
  badge?: string;
  url?: string;
  tag?: string;
  data?: Record<string, unknown>;
};

export type DeepLink =
  | { type: "channel"; slug: string }
  | { type: "dm"; id: number };
