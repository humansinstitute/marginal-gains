/**
 * Wingman AI Assistant Service
 * Handles AI-powered responses in chat threads using OpenRouter
 */

import { randomUUID } from "crypto";
import { mkdir } from "fs/promises";
import { join } from "path";

import {
  OR_API_KEY,
  getWingmanIdentity,
  WINGMAN_DEFAULT_SYSTEM_PROMPT,
  WINGMAN_DEFAULT_MODEL,
} from "../config";
import { getSetting, listThreadMessages, createMessage, getUserByNpub, recordWingmanCost } from "../db";
import { ASSETS_ROOT } from "../routes/assets";

import { getWingmanChannelAccess, decryptMessageForWingman } from "./crypto";
import { broadcast } from "./events";

import type { Message } from "../db";

export interface OpenRouterUsage {
  prompt_tokens: number;
  completion_tokens: number;
  total_tokens: number;
}

export interface OpenRouterImage {
  type: "image_url";
  image_url: {
    url: string; // Base64 data URL: "data:image/png;base64,..."
  };
}

export interface OpenRouterMessage {
  role: string;
  content: string;
  images?: OpenRouterImage[];
}

export interface OpenRouterResponse {
  id: string;
  model: string;
  choices: Array<{ message: OpenRouterMessage }>;
  usage?: OpenRouterUsage;
}

// Models that support image generation (have "image" in output_modalities)
const IMAGE_GENERATION_MODELS = new Set([
  "google/gemini-3-pro-image-preview",
  "google/gemini-2.5-flash-image-preview",
  "black-forest-labs/flux.2-pro",
  "black-forest-labs/flux.2-flex",
]);

// Settings keys
const SETTING_SYSTEM_PROMPT = "wingman_system_prompt";
const SETTING_MODEL = "wingman_model";
const SETTING_ENABLED = "wingman_enabled";

export interface WingmanSettings {
  enabled: boolean;
  systemPrompt: string;
  model: string;
}

/**
 * Get current Wingman settings from database
 */
export function getWingmanSettings(): WingmanSettings {
  return {
    enabled: getSetting(SETTING_ENABLED) !== "false", // Default to true if not set
    systemPrompt: getSetting(SETTING_SYSTEM_PROMPT) ?? WINGMAN_DEFAULT_SYSTEM_PROMPT,
    model: getSetting(SETTING_MODEL) ?? WINGMAN_DEFAULT_MODEL,
  };
}

/**
 * Check if Wingman is available (has key and enabled)
 */
export function isWingmanAvailable(): boolean {
  const identity = getWingmanIdentity();
  if (!identity) return false;
  if (!OR_API_KEY) return false;
  const settings = getWingmanSettings();
  return settings.enabled;
}

export interface BuildThreadContextResult {
  context: string;
  hasEncryptedMessages: boolean;
  accessError?: string;
}

/**
 * Build context from a thread for the LLM
 * Format: [Author - Time]\nMessage body
 *
 * Handles decryption of encrypted messages if Wingman has access.
 * This function is isolated for easy future modification
 * (token limits, truncation, summarization, etc.)
 */
export async function buildThreadContext(
  threadRootId: number,
  channelId: number
): Promise<BuildThreadContextResult> {
  const messages = listThreadMessages(threadRootId);

  // Check if any messages are encrypted
  const hasEncryptedMessages = messages.some((msg) => msg.encrypted);

  // If there are encrypted messages, check Wingman's access first
  if (hasEncryptedMessages) {
    const access = getWingmanChannelAccess(channelId);
    if (!access.hasAccess) {
      return {
        context: "",
        hasEncryptedMessages: true,
        accessError: access.reason,
      };
    }
  }

  // Build context, decrypting messages as needed
  const contextParts: string[] = [];

  for (const msg of messages) {
    const author = getAuthorDisplayName(msg.author);
    const time = formatTime(msg.created_at);

    let body = msg.body;
    if (msg.encrypted) {
      const decrypted = await decryptMessageForWingman(msg.body, true, channelId);
      body = decrypted.content;
    }

    contextParts.push(`[${author} - ${time}]\n${body}`);
  }

  return {
    context: contextParts.join("\n\n"),
    hasEncryptedMessages,
  };
}

/**
 * Get display name for an author npub
 */
function getAuthorDisplayName(npub: string): string {
  const user = getUserByNpub(npub);
  if (user?.display_name) return user.display_name;
  if (user?.name) return user.name;
  // Fallback to short npub
  return npub.slice(0, 12) + "...";
}

/**
 * Format timestamp for context
 */
function formatTime(isoString: string): string {
  const date = new Date(isoString);
  return date.toLocaleTimeString("en-US", {
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  });
}

export interface CallOpenRouterResult {
  content: string;
  usage?: OpenRouterUsage;
  model: string;
  images?: OpenRouterImage[];
}

/**
 * Check if a model supports image generation
 */
function supportsImageGeneration(model: string): boolean {
  return IMAGE_GENERATION_MODELS.has(model);
}

/**
 * Call OpenRouter API for completion
 */
export async function callOpenRouter(
  systemPrompt: string,
  userContent: string,
  model: string
): Promise<CallOpenRouterResult> {
  // Build request body - include modalities for image-capable models
  const requestBody: Record<string, unknown> = {
    model,
    messages: [
      { role: "system", content: systemPrompt },
      { role: "user", content: userContent },
    ],
  };

  // Add modalities for image generation models
  if (supportsImageGeneration(model)) {
    requestBody.modalities = ["image", "text"];
  }

  const response = await fetch("https://openrouter.ai/api/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${OR_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(requestBody),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`OpenRouter API error: ${response.status} - ${errorText}`);
  }

  const data = (await response.json()) as OpenRouterResponse;

  const message = data.choices?.[0]?.message;
  if (!message) {
    throw new Error("Invalid response from OpenRouter API");
  }

  // Content might be empty if only images were returned
  const content = message.content || "";

  return {
    content,
    usage: data.usage,
    model: data.model || model,
    images: message.images,
  };
}

/**
 * Estimate cost based on model and token usage
 * Prices are approximate and should be updated periodically
 */
function estimateCost(model: string, usage: OpenRouterUsage): number {
  // Prices per 1M tokens (input/output) - approximate values
  const modelPrices: Record<string, { input: number; output: number }> = {
    "anthropic/claude-opus-4.5": { input: 15, output: 75 },
    "anthropic/claude-sonnet-4.5": { input: 3, output: 15 },
    "anthropic/claude-haiku-4.5": { input: 0.8, output: 4 },
    "openai/gpt-5.2-pro": { input: 10, output: 30 },
    "openai/gpt-5.2-chat": { input: 5, output: 15 },
    "openai/gpt-5.2": { input: 2, output: 10 },
    "google/gemini-3-pro-preview": { input: 1.25, output: 5 },
    "google/gemini-3-pro-image-preview": { input: 1.25, output: 5 },
    "google/gemini-3-flash-preview": { input: 0.075, output: 0.3 },
    "moonshotai/kimi-k2-thinking": { input: 0.6, output: 2.4 },
    "z-ai/glm-4.7": { input: 0.4, output: 1.2 },
  };

  // Default fallback pricing
  const defaultPrice = { input: 1, output: 3 };
  const prices = modelPrices[model] || defaultPrice;

  const inputCost = (usage.prompt_tokens / 1_000_000) * prices.input;
  const outputCost = (usage.completion_tokens / 1_000_000) * prices.output;

  return inputCost + outputCost;
}

/**
 * Get date folder string for asset storage
 */
function getDateFolder(): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
}

/**
 * Parse a base64 data URL and extract the image data
 * Returns { mimeType, extension, buffer } or null if invalid
 */
function parseBase64DataUrl(dataUrl: string): { mimeType: string; extension: string; buffer: Buffer } | null {
  // Format: data:image/png;base64,iVBORw0...
  const match = dataUrl.match(/^data:(image\/([a-z]+));base64,(.+)$/i);
  if (!match) return null;

  const mimeType = match[1];
  const extension = `.${match[2].toLowerCase()}`;
  const base64Data = match[3];

  try {
    const buffer = Buffer.from(base64Data, "base64");
    return { mimeType, extension, buffer };
  } catch {
    return null;
  }
}

/**
 * Save base64 images from OpenRouter response to user's asset directory
 * Returns array of local asset URLs
 */
async function saveImagesToAssets(
  images: OpenRouterImage[],
  npub: string
): Promise<string[]> {
  const savedUrls: string[] = [];
  const dateFolder = getDateFolder();
  const userDir = join(ASSETS_ROOT, npub, dateFolder);

  // Create directory if needed
  try {
    await mkdir(userDir, { recursive: true });
  } catch (error) {
    console.error("[Wingman] Failed to create asset directory:", error);
    return savedUrls;
  }

  for (const image of images) {
    const dataUrl = image.image_url?.url;
    if (!dataUrl) continue;

    const parsed = parseBase64DataUrl(dataUrl);
    if (!parsed) {
      console.warn("[Wingman] Could not parse image data URL");
      continue;
    }

    const filename = `${randomUUID()}${parsed.extension}`;
    const filePath = join(userDir, filename);

    try {
      await Bun.write(filePath, parsed.buffer);
      const url = `/assets/${npub}/${dateFolder}/${filename}`;
      savedUrls.push(url);
      console.log(`[Wingman] Saved image: ${url}`);
    } catch (error) {
      console.error("[Wingman] Failed to save image:", error);
    }
  }

  return savedUrls;
}

/**
 * Format response content with images as markdown
 */
function formatResponseWithImages(content: string, imageUrls: string[]): string {
  if (imageUrls.length === 0) return content;

  // Append images as markdown at the end of the content
  const imageMarkdown = imageUrls
    .map((url, i) => `![Generated Image ${i + 1}](${url})`)
    .join("\n\n");

  if (content.trim()) {
    return `${content}\n\n${imageMarkdown}`;
  }
  return imageMarkdown;
}

/**
 * Handle a Wingman request
 * Called when /wingman is detected in a message
 */
export async function handleWingmanRequest(
  triggeringMessage: Message,
  args: string // Additional instructions after /wingman
): Promise<void> {
  const identity = getWingmanIdentity();
  if (!identity) {
    console.error("[Wingman] No identity configured");
    return;
  }

  const settings = getWingmanSettings();
  if (!settings.enabled) {
    console.log("[Wingman] Disabled, skipping request");
    return;
  }

  if (!OR_API_KEY) {
    console.error("[Wingman] No OpenRouter API key configured");
    return;
  }

  // Determine thread context
  // If the message is in a thread, use that thread
  // If it's a root message, use just that message as context
  const threadRootId = triggeringMessage.thread_root_id ?? triggeringMessage.id;
  const channelId = triggeringMessage.channel_id;

  // Broadcast thinking indicator
  broadcast({
    type: "wingman:thinking",
    data: {
      threadId: threadRootId,
      channelId,
    },
    channelId,
  });

  try {
    // Build context from thread (handles decryption if needed)
    const threadResult = await buildThreadContext(threadRootId, channelId);

    // Check if Wingman lacks access to encrypted content
    if (threadResult.accessError) {
      console.log(`[Wingman] Access denied: ${threadResult.accessError}`);

      const accessDeniedMessage = createMessage(
        channelId,
        identity.npub,
        threadResult.accessError,
        threadRootId,
        triggeringMessage.id,
        null
      );

      if (accessDeniedMessage) {
        broadcast({
          type: "message:new",
          data: {
            ...accessDeniedMessage,
            channelId,
          },
          channelId,
        });
      }
      return;
    }

    // Build the user prompt
    let userPrompt = "Please answer this user question based on the conversation context:\n\n";
    userPrompt += threadResult.context;

    if (args.trim()) {
      userPrompt += `\n\nAdditional instructions: ${args.trim()}`;
    }

    console.log(`[Wingman] Processing request in thread ${threadRootId}${threadResult.hasEncryptedMessages ? " (decrypted)" : ""}`);

    // Call OpenRouter
    const result = await callOpenRouter(
      settings.systemPrompt,
      userPrompt,
      settings.model
    );

    // Record cost if usage data is available
    if (result.usage) {
      const cost = estimateCost(result.model, result.usage);
      recordWingmanCost(
        triggeringMessage.author,
        result.model,
        result.usage.prompt_tokens,
        result.usage.completion_tokens,
        result.usage.total_tokens,
        cost
      );
      console.log(`[Wingman] Recorded cost: $${cost.toFixed(6)} for ${result.usage.total_tokens} tokens`);
    }

    // Process images if present - save to requesting user's asset directory
    let responseContent = result.content;
    if (result.images && result.images.length > 0) {
      console.log(`[Wingman] Processing ${result.images.length} image(s) from response`);
      const imageUrls = await saveImagesToAssets(result.images, triggeringMessage.author);
      responseContent = formatResponseWithImages(result.content, imageUrls);
    }

    // Create Wingman's response message in the same thread
    // Use threadRootId as parent so it appears as a direct reply in the thread
    const wingmanMessage = createMessage(
      channelId,
      identity.npub,
      responseContent,
      threadRootId,
      threadRootId, // Reply to thread root so it shows in thread view
      null
    );

    if (wingmanMessage) {
      // Broadcast the new message (include channelId in data, matching chat.ts format)
      broadcast({
        type: "message:new",
        data: {
          ...wingmanMessage,
          channelId,
        },
        channelId,
      });
      console.log(`[Wingman] Response posted: message ${wingmanMessage.id}`);
    }
  } catch (error) {
    console.error("[Wingman] Error processing request:", error);

    // Post error message
    const errorMessage = createMessage(
      channelId,
      identity.npub,
      "Sorry, I couldn't process that request. Please try again later.",
      threadRootId,
      triggeringMessage.id,
      null
    );

    if (errorMessage) {
      broadcast({
        type: "message:new",
        data: {
          ...errorMessage,
          channelId,
        },
        channelId,
      });
    }
  }
}

// Default image generation model
const IMAGE_WINGMAN_MODEL = "google/gemini-3-pro-image-preview";

/**
 * Handle an Image Wingman request
 * Called when /image-wingman is detected in a message
 * Always uses the image generation model regardless of settings
 */
export async function handleImageWingmanRequest(
  triggeringMessage: Message,
  args: string
): Promise<void> {
  const identity = getWingmanIdentity();
  if (!identity) {
    console.error("[Wingman] No identity configured");
    return;
  }

  const settings = getWingmanSettings();
  if (!settings.enabled) {
    console.log("[Wingman] Disabled, skipping request");
    return;
  }

  if (!OR_API_KEY) {
    console.error("[Wingman] No OpenRouter API key configured");
    return;
  }

  const threadRootId = triggeringMessage.thread_root_id ?? triggeringMessage.id;
  const channelId = triggeringMessage.channel_id;

  // Broadcast thinking indicator
  broadcast({
    type: "wingman:thinking",
    data: {
      threadId: threadRootId,
      channelId,
    },
    channelId,
  });

  try {
    // Build context from thread (handles decryption if needed)
    const threadResult = await buildThreadContext(threadRootId, channelId);

    // Check if Wingman lacks access to encrypted content
    if (threadResult.accessError) {
      console.log(`[Wingman] Access denied: ${threadResult.accessError}`);

      const accessDeniedMessage = createMessage(
        channelId,
        identity.npub,
        threadResult.accessError,
        threadRootId,
        triggeringMessage.id,
        null
      );

      if (accessDeniedMessage) {
        broadcast({
          type: "message:new",
          data: {
            ...accessDeniedMessage,
            channelId,
          },
          channelId,
        });
      }
      return;
    }

    // Build the user prompt - emphasize image generation
    let userPrompt = "Generate an image based on this request. ";
    userPrompt += "The user is asking for visual content.\n\n";
    userPrompt += threadResult.context;

    if (args.trim()) {
      userPrompt += `\n\nImage request: ${args.trim()}`;
    }

    console.log(`[Wingman] Processing image request in thread ${threadRootId}${threadResult.hasEncryptedMessages ? " (decrypted)" : ""}`);

    // Call OpenRouter with image model
    const result = await callOpenRouter(
      settings.systemPrompt,
      userPrompt,
      IMAGE_WINGMAN_MODEL
    );

    // Record cost if usage data is available
    if (result.usage) {
      const cost = estimateCost(result.model, result.usage);
      recordWingmanCost(
        triggeringMessage.author,
        result.model,
        result.usage.prompt_tokens,
        result.usage.completion_tokens,
        result.usage.total_tokens,
        cost
      );
      console.log(`[Wingman] Recorded cost: $${cost.toFixed(6)} for ${result.usage.total_tokens} tokens`);
    }

    // Process images if present
    let responseContent = result.content;
    if (result.images && result.images.length > 0) {
      console.log(`[Wingman] Processing ${result.images.length} image(s) from response`);
      const imageUrls = await saveImagesToAssets(result.images, triggeringMessage.author);
      responseContent = formatResponseWithImages(result.content, imageUrls);
    }

    // Create Wingman's response message
    const wingmanMessage = createMessage(
      channelId,
      identity.npub,
      responseContent,
      threadRootId,
      threadRootId,
      null
    );

    if (wingmanMessage) {
      broadcast({
        type: "message:new",
        data: {
          ...wingmanMessage,
          channelId,
        },
        channelId,
      });
      console.log(`[Wingman] Image response posted: message ${wingmanMessage.id}`);
    }
  } catch (error) {
    console.error("[Wingman] Error processing image request:", error);

    const errorMessage = createMessage(
      channelId,
      identity.npub,
      "Sorry, I couldn't generate that image. Please try again later.",
      threadRootId,
      triggeringMessage.id,
      null
    );

    if (errorMessage) {
      broadcast({
        type: "message:new",
        data: {
          ...errorMessage,
          channelId,
        },
        channelId,
      });
    }
  }
}
