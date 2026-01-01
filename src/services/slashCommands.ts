/**
 * Slash Command System
 * Extensible command registry and executor for chat messages
 */

import { isAdmin } from "../config";

import { handleWingmanRequest, handleImageWingmanRequest, isWingmanAvailable } from "./wingman";

import type { Message } from "../db";

export interface SlashCommandContext {
  message: Message;       // The triggering message
  authorNpub: string;     // npub of invoker
  channelId: number;
  threadRootId: number | null;
  args: string;           // Text after the command
}

export interface SlashCommand {
  name: string;           // e.g., "wingman"
  description: string;    // For autocomplete tooltip
  adminOnly: boolean;     // Access control
  isAvailable: () => boolean; // Runtime availability check
  handler: (ctx: SlashCommandContext) => Promise<void>;
}

// Command registry
const commands = new Map<string, SlashCommand>();

/**
 * Register a slash command
 */
export function registerCommand(command: SlashCommand): void {
  commands.set(command.name.toLowerCase(), command);
}

/**
 * Get all registered commands (for autocomplete)
 */
export function getCommands(): SlashCommand[] {
  return Array.from(commands.values());
}

/**
 * Get available commands for a user (respects adminOnly)
 */
export function getAvailableCommands(isUserAdmin: boolean): SlashCommand[] {
  return getCommands().filter((cmd) => {
    if (cmd.adminOnly && !isUserAdmin) return false;
    return cmd.isAvailable();
  });
}

/**
 * Parse slash commands from message body
 * Returns array of { command, args, fullMatch }
 *
 * Matches /command anywhere in the message
 */
export function parseSlashCommands(
  body: string
): Array<{ command: string; args: string; fullMatch: string }> {
  const results: Array<{ command: string; args: string; fullMatch: string }> = [];

  // Match /command followed by optional args (until next /command or end of line)
  // This regex finds /word patterns (including hyphens in command names)
  const commandPattern = /\/([\w-]+)(?:\s+([^/\n]*))?/g;

  let match;
  while ((match = commandPattern.exec(body)) !== null) {
    results.push({
      command: match[1].toLowerCase(),
      args: (match[2] || "").trim(),
      fullMatch: match[0],
    });
  }

  return results;
}

/**
 * Execute slash commands found in a message
 * Called after message is saved to database
 */
export async function executeSlashCommands(
  message: Message,
  authorNpub: string
): Promise<void> {
  const parsed = parseSlashCommands(message.body);

  if (parsed.length === 0) return;

  const userIsAdmin = isAdmin(authorNpub);

  for (const { command, args } of parsed) {
    const cmd = commands.get(command);

    if (!cmd) {
      console.log(`[SlashCommands] Unknown command: /${command}`);
      continue;
    }

    // Check admin access
    if (cmd.adminOnly && !userIsAdmin) {
      console.log(`[SlashCommands] Access denied for /${command} - admin only`);
      continue;
    }

    // Check availability
    if (!cmd.isAvailable()) {
      console.log(`[SlashCommands] Command /${command} not available`);
      continue;
    }

    // Execute command
    console.log(`[SlashCommands] Executing /${command} with args: "${args}"`);

    try {
      await cmd.handler({
        message,
        authorNpub,
        channelId: message.channel_id,
        threadRootId: message.thread_root_id,
        args,
      });
    } catch (error) {
      console.error(`[SlashCommands] Error executing /${command}:`, error);
    }
  }
}

// Register built-in commands

registerCommand({
  name: "wingman",
  description: "Ask Wingman AI for help",
  adminOnly: true,
  isAvailable: isWingmanAvailable,
  handler: async (ctx) => {
    await handleWingmanRequest(ctx.message, ctx.args);
  },
});

registerCommand({
  name: "image-wingman",
  description: "Generate an image with Wingman AI",
  adminOnly: true,
  isAvailable: isWingmanAvailable,
  handler: async (ctx) => {
    await handleImageWingmanRequest(ctx.message, ctx.args);
  },
});
