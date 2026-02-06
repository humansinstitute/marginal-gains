import { randomUUID } from "crypto";
import { mkdir } from "fs/promises";
import { join, extname } from "path";

import { isAdmin } from "../config";

import type { Session } from "../types";

export const ASSETS_ROOT = join(import.meta.dir, "../../assets");
const MAX_SIZE_USER = 50 * 1024 * 1024; // 50MB
const MAX_SIZE_ADMIN = 256 * 1024 * 1024; // 256MB

// Blocked extensions for security (executables, scripts)
// Admins bypass this check
const BLOCKED_EXTENSIONS = new Set([
  ".exe", ".bat", ".cmd", ".com", ".msi", ".scr",
  ".ps1", ".vbs", ".vbe", ".js", ".jse", ".ws", ".wsf",
  ".sh", ".bash", ".zsh", ".csh",
  ".app", ".dmg", ".pkg",
  ".dll", ".so", ".dylib",
]);

// Image extensions for isImage flag
const IMAGE_EXTENSIONS = new Set([
  ".jpg", ".jpeg", ".png", ".gif", ".webp", ".svg", ".bmp", ".ico",
]);

// Video extensions for isVideo flag
const VIDEO_EXTENSIONS = new Set([
  ".mp4", ".webm", ".mov", ".ogg", ".m4v",
]);

function getExtension(filename?: string): string {
  if (!filename) return "";
  return extname(filename).toLowerCase();
}

function isImageFile(filename?: string, mime?: string): boolean {
  const ext = getExtension(filename);
  if (IMAGE_EXTENSIONS.has(ext)) return true;
  return mime?.startsWith("image/") ?? false;
}

function isVideoFile(filename?: string, mime?: string): boolean {
  const ext = getExtension(filename);
  if (VIDEO_EXTENSIONS.has(ext)) return true;
  return mime?.startsWith("video/") ?? false;
}

function getDateFolder(): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
}

export async function handleAssetUpload(req: Request, session: Session | null): Promise<Response> {
  if (!session) {
    return Response.json({ error: "Authentication required" }, { status: 401 });
  }

  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return Response.json({ error: "Invalid form data" }, { status: 400 });
  }

  const fileEntry = form.get("file") ?? form.get("image");
  if (!fileEntry || typeof (fileEntry as Blob).arrayBuffer !== "function") {
    return Response.json({ error: "File is required" }, { status: 400 });
  }

  const file = fileEntry as File;
  const mime = file.type || "application/octet-stream";
  const ext = getExtension(file.name) || ".bin";
  const userIsAdmin = isAdmin(session.npub);

  // Block dangerous file types (admins bypass this)
  if (!userIsAdmin && BLOCKED_EXTENSIONS.has(ext)) {
    return Response.json({ error: `File type ${ext} not allowed` }, { status: 400 });
  }

  // Check size limit based on admin status
  const maxSize = userIsAdmin ? MAX_SIZE_ADMIN : MAX_SIZE_USER;
  if (file.size > maxSize) {
    const limitMb = maxSize / (1024 * 1024);
    return Response.json({ error: `File exceeds ${limitMb}MB limit` }, { status: 413 });
  }

  // Create directory structure: assets/<npub>/<date>/
  const dateFolder = getDateFolder();
  const userDir = join(ASSETS_ROOT, session.npub, dateFolder);
  try {
    await mkdir(userDir, { recursive: true });
  } catch (error) {
    console.error("[assets] Failed to create directory:", error);
    return Response.json({ error: "Failed to prepare storage" }, { status: 500 });
  }

  // Generate unique filename preserving original extension
  const filename = `${randomUUID()}${ext}`;
  const filePath = join(userDir, filename);

  // Write file to disk
  try {
    const buffer = Buffer.from(await file.arrayBuffer());
    await Bun.write(filePath, buffer);
  } catch (error) {
    console.error("[assets] Failed to write file:", error);
    return Response.json({ error: "Failed to store file" }, { status: 500 });
  }

  // Build public URL
  const url = `/assets/${session.npub}/${dateFolder}/${filename}`;

  return Response.json({
    url,
    name: file.name,
    type: mime,
    size: file.size,
    isImage: isImageFile(file.name, mime),
    isVideo: isVideoFile(file.name, mime),
  });
}

export async function serveAsset(pathname: string): Promise<Response | null> {
  // pathname is like /assets/npub1.../2025-12-29/uuid.jpg
  if (!pathname.startsWith("/assets/")) return null;

  const relativePath = pathname.slice("/assets/".length);
  // Basic path traversal protection
  if (relativePath.includes("..")) {
    return new Response("Forbidden", { status: 403 });
  }

  const filePath = join(ASSETS_ROOT, relativePath);

  try {
    const file = Bun.file(filePath);
    const exists = await file.exists();
    if (!exists) return null;

    return new Response(file, {
      headers: {
        "Content-Type": file.type || "application/octet-stream",
        "Cache-Control": "public, max-age=31536000, immutable",
      },
    });
  } catch {
    return null;
  }
}
