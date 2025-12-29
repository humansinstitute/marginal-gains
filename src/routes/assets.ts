import { mkdir, stat } from "fs/promises";
import { join, extname } from "path";
import { randomUUID } from "crypto";
import { isAdmin } from "../config";
import type { Session } from "../types";

export const ASSETS_ROOT = join(import.meta.dir, "../../assets");
const MAX_SIZE_USER = 50 * 1024 * 1024; // 50MB
const MAX_SIZE_ADMIN = 256 * 1024 * 1024; // 256MB

const ALLOWED_IMAGE_TYPES = new Set([
  "image/jpeg",
  "image/png",
  "image/gif",
  "image/webp",
  "image/svg+xml",
]);

const ALLOWED_FILE_TYPES = new Set([
  ...ALLOWED_IMAGE_TYPES,
  "application/pdf",
  "text/plain",
  "text/csv",
  "application/json",
  "application/zip",
  "application/x-zip-compressed",
]);

function inferExtension(mime: string, originalName?: string): string {
  const originalExt = originalName ? extname(originalName).toLowerCase() : "";
  if (originalExt) return originalExt;

  const mimeToExt: Record<string, string> = {
    "image/jpeg": ".jpg",
    "image/png": ".png",
    "image/gif": ".gif",
    "image/webp": ".webp",
    "image/svg+xml": ".svg",
    "application/pdf": ".pdf",
    "text/plain": ".txt",
    "text/csv": ".csv",
    "application/json": ".json",
    "application/zip": ".zip",
    "application/x-zip-compressed": ".zip",
  };
  return mimeToExt[mime] ?? ".bin";
}

function getDateFolder(): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
}

function isImageType(mime: string): boolean {
  return ALLOWED_IMAGE_TYPES.has(mime);
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

  // Validate file type
  if (!ALLOWED_FILE_TYPES.has(mime)) {
    return Response.json({ error: `File type ${mime} not allowed` }, { status: 400 });
  }

  // Check size limit based on admin status
  const maxSize = isAdmin(session.npub) ? MAX_SIZE_ADMIN : MAX_SIZE_USER;
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

  // Generate unique filename
  const ext = inferExtension(mime, file.name);
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
    isImage: isImageType(mime),
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
