import { APP_NAME_DEFAULT, isAdmin } from "../config";
import { getSetting, setSetting } from "../db";

import type { Session } from "../types";

const jsonHeaders = { "Content-Type": "application/json" };

function jsonResponse(data: unknown) {
  return new Response(JSON.stringify(data), { headers: jsonHeaders });
}

function unauthorized() {
  return new Response(JSON.stringify({ error: "Unauthorized" }), {
    status: 401,
    headers: jsonHeaders,
  });
}

function forbidden(message: string) {
  return new Response(JSON.stringify({ error: message }), {
    status: 403,
    headers: jsonHeaders,
  });
}

const SETTING_APP_NAME = "app.name";
const SETTING_FAVICON_URL = "app.favicon_url";

/**
 * Get the configured app name, or default if not set
 */
export function getAppName(): string {
  return getSetting(SETTING_APP_NAME) || APP_NAME_DEFAULT;
}

/**
 * Get the configured favicon URL, or empty string for default
 */
export function getFaviconUrl(): string {
  return getSetting(SETTING_FAVICON_URL) || "";
}

export function getAppSettings() {
  return {
    appName: getSetting(SETTING_APP_NAME) || "",
    faviconUrl: getSetting(SETTING_FAVICON_URL) || "",
  };
}

/**
 * GET /manifest.webmanifest
 * Dynamic manifest with custom app name
 */
export function handleManifest() {
  const appName = getAppName();
  const faviconUrl = getFaviconUrl();

  // Use custom favicon if set, otherwise use default icons
  // Android uses 192x192 and 512x512, iOS uses apple-touch-icon link tag
  const icons = faviconUrl
    ? [
        { src: faviconUrl, sizes: "192x192", type: "image/png", purpose: "any maskable" },
        { src: faviconUrl, sizes: "512x512", type: "image/png", purpose: "any maskable" },
      ]
    : [
        { src: "/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any maskable" },
        { src: "/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any maskable" },
      ];

  const manifest = {
    name: appName,
    short_name: appName.length > 12 ? appName.slice(0, 12) : appName,
    start_url: "/chat",
    display: "standalone",
    background_color: "#f4f4f4",
    theme_color: "#6b3a6b",
    icons,
  };

  return new Response(JSON.stringify(manifest, null, 2), {
    headers: {
      "Content-Type": "application/manifest+json",
      "Cache-Control": "no-cache",
    },
  });
}

/**
 * GET /api/app/settings
 * Get app settings (admin only)
 */
export function handleGetAppSettings(session: Session | null) {
  if (!session) return unauthorized();
  if (!isAdmin(session.npub)) {
    return forbidden("Only admins can access app settings");
  }

  return jsonResponse(getAppSettings());
}

/**
 * PATCH /api/app/settings
 * Update app settings (admin only)
 */
export async function handleUpdateAppSettings(req: Request, session: Session | null) {
  if (!session) return unauthorized();
  if (!isAdmin(session.npub)) {
    return forbidden("Only admins can update app settings");
  }

  const body = await req.json();
  const { appName, faviconUrl } = body;

  // Update each setting if provided (allow empty string to clear)
  if (typeof appName === "string") {
    if (appName.trim()) {
      setSetting(SETTING_APP_NAME, appName.trim());
    } else {
      // Clear the setting to use default
      setSetting(SETTING_APP_NAME, "");
    }
  }

  if (typeof faviconUrl === "string") {
    if (faviconUrl.trim()) {
      setSetting(SETTING_FAVICON_URL, faviconUrl.trim());
    } else {
      // Clear the setting to use default
      setSetting(SETTING_FAVICON_URL, "");
    }
  }

  return jsonResponse(getAppSettings());
}
