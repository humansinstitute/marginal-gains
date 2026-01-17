/**
 * Image processing utilities
 *
 * Provides functions for resizing and optimizing images for web use.
 * Uses sharp library for high-quality, fast image processing.
 */

import { mkdir } from "node:fs/promises";
import { extname, join } from "node:path";

import sharp from "sharp";

/**
 * Image size presets for different use cases
 */
export const IMAGE_SIZES = {
  /** Small icon for lists, cards, etc. */
  icon: { width: 48, height: 48 },
  /** Standard size for headers, avatars */
  standard: { width: 192, height: 192 },
  /** Large size for full display */
  large: { width: 512, height: 512 },
} as const;

export type ImageSizePreset = keyof typeof IMAGE_SIZES;

/**
 * Result of processing an image
 */
export type ProcessedImage = {
  /** Relative URL path to the processed image */
  url: string;
  /** Absolute file path */
  path: string;
  /** Width in pixels */
  width: number;
  /** Height in pixels */
  height: number;
  /** File size in bytes */
  size: number;
};

/**
 * Result of processing an image at multiple sizes
 */
export type ProcessedImageSet = {
  /** Original filename */
  originalName: string;
  /** Map of size preset to processed image */
  images: Record<ImageSizePreset, ProcessedImage>;
};

/**
 * Options for image processing
 */
export type ProcessImageOptions = {
  /** Sizes to generate (defaults to all) */
  sizes?: ImageSizePreset[];
  /** JPEG/WebP quality (1-100, default 85) */
  quality?: number;
  /** Output format (default: webp for best compression) */
  format?: "webp" | "png" | "jpeg";
  /** Base directory for output (default: public/uploads) */
  outputDir?: string;
  /** Subdirectory within outputDir for organizing files */
  subDir?: string;
};

const DEFAULT_OPTIONS: Required<ProcessImageOptions> = {
  sizes: ["icon", "standard"],
  quality: 85,
  format: "webp",
  outputDir: "public/uploads",
  subDir: "",
};

/**
 * Generate a unique filename for an image
 */
function generateFilename(originalName: string, size: ImageSizePreset, format: string): string {
  const baseName = originalName.replace(/\.[^.]+$/, "").replace(/[^a-zA-Z0-9-_]/g, "-");
  const timestamp = Date.now();
  const random = Math.random().toString(36).substring(2, 8);
  return `${baseName}-${size}-${timestamp}-${random}.${format}`;
}

/**
 * Process a single image buffer at a specific size
 */
async function processAtSize(
  buffer: Buffer,
  size: { width: number; height: number },
  options: Required<ProcessImageOptions>
): Promise<Buffer> {
  let processor = sharp(buffer).resize(size.width, size.height, {
    fit: "cover",
    position: "center",
  });

  switch (options.format) {
    case "webp":
      processor = processor.webp({ quality: options.quality });
      break;
    case "png":
      processor = processor.png({ quality: options.quality, compressionLevel: 9 });
      break;
    case "jpeg":
      processor = processor.jpeg({ quality: options.quality, mozjpeg: true });
      break;
  }

  return processor.toBuffer();
}

/**
 * Process an image buffer and save at multiple sizes
 *
 * @param buffer - The image buffer to process
 * @param originalName - Original filename (for naming output files)
 * @param options - Processing options
 * @returns Processed image set with URLs and metadata
 *
 * @example
 * ```typescript
 * const result = await processImage(fileBuffer, "team-logo.png", {
 *   sizes: ["icon", "standard"],
 *   subDir: "teams/my-team",
 * });
 * // result.images.icon.url -> "/uploads/teams/my-team/team-logo-icon-xxx.webp"
 * // result.images.standard.url -> "/uploads/teams/my-team/team-logo-standard-xxx.webp"
 * ```
 */
export async function processImage(
  buffer: Buffer,
  originalName: string,
  options: ProcessImageOptions = {}
): Promise<ProcessedImageSet> {
  const opts = { ...DEFAULT_OPTIONS, ...options };

  // Build output directory path
  const outputPath = opts.subDir ? join(opts.outputDir, opts.subDir) : opts.outputDir;

  // Ensure output directory exists
  await mkdir(outputPath, { recursive: true });

  const images: Partial<Record<ImageSizePreset, ProcessedImage>> = {};

  for (const sizeKey of opts.sizes) {
    const size = IMAGE_SIZES[sizeKey];
    const filename = generateFilename(originalName, sizeKey, opts.format);
    const filePath = join(outputPath, filename);

    // Process the image
    const processed = await processAtSize(buffer, size, opts);

    // Write to disk
    await Bun.write(filePath, processed);

    // Build URL path (relative to public/)
    const urlPath = filePath.replace(/^public/, "");

    images[sizeKey] = {
      url: urlPath,
      path: filePath,
      width: size.width,
      height: size.height,
      size: processed.length,
    };
  }

  return {
    originalName,
    images: images as Record<ImageSizePreset, ProcessedImage>,
  };
}

/**
 * Process an image from a base64 data URL
 *
 * @param dataUrl - Base64 data URL (e.g., "data:image/png;base64,...")
 * @param originalName - Original filename
 * @param options - Processing options
 */
export async function processImageFromDataUrl(
  dataUrl: string,
  originalName: string,
  options: ProcessImageOptions = {}
): Promise<ProcessedImageSet> {
  // Parse the data URL
  const match = dataUrl.match(/^data:image\/(\w+);base64,(.+)$/);
  if (!match) {
    throw new Error("Invalid data URL format");
  }

  const buffer = Buffer.from(match[2], "base64");
  return processImage(buffer, originalName, options);
}

/**
 * Process an image from a File object (for form uploads)
 *
 * @param file - File object from form data
 * @param options - Processing options
 */
export async function processImageFromFile(
  file: File,
  options: ProcessImageOptions = {}
): Promise<ProcessedImageSet> {
  const arrayBuffer = await file.arrayBuffer();
  const buffer = Buffer.from(arrayBuffer);
  return processImage(buffer, file.name, options);
}

/**
 * Delete processed images from disk
 *
 * @param imageSet - The processed image set to delete
 */
export async function deleteProcessedImages(imageSet: ProcessedImageSet): Promise<void> {
  const { unlink } = await import("node:fs/promises");

  for (const image of Object.values(imageSet.images)) {
    try {
      await unlink(image.path);
    } catch {
      // Ignore errors (file may already be deleted)
    }
  }
}

/**
 * Check if a file is a valid image based on its MIME type or extension
 */
export function isValidImage(file: File): boolean {
  const validMimeTypes = ["image/jpeg", "image/png", "image/gif", "image/webp", "image/svg+xml"];
  const validExtensions = [".jpg", ".jpeg", ".png", ".gif", ".webp", ".svg"];

  if (validMimeTypes.includes(file.type)) {
    return true;
  }

  const ext = extname(file.name).toLowerCase();
  return validExtensions.includes(ext);
}

/**
 * Get the recommended format for an image based on its content
 * (SVGs should stay as SVG, photos work well as WebP)
 */
export function getRecommendedFormat(file: File): "webp" | "png" | "jpeg" {
  // SVGs should be handled separately (not resized)
  if (file.type === "image/svg+xml" || file.name.endsWith(".svg")) {
    return "png"; // Convert SVG to PNG for resizing
  }

  // PNGs with transparency should use WebP (supports alpha)
  if (file.type === "image/png") {
    return "webp";
  }

  // Default to WebP for best compression
  return "webp";
}
