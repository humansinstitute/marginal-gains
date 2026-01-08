export type TodoState = "new" | "ready" | "in_progress" | "review" | "done";
export type TodoPriority = "rock" | "pebble" | "sand";

export type Session = {
  token: string;
  pubkey: string;
  npub: string;
  method: LoginMethod;
  createdAt: number;
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
