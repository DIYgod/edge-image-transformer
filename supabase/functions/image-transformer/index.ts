import "jsr:@supabase/functions-js/edge-runtime.d.ts";

import { Hono } from "hono";
import type { Context } from "hono";

import { ensureCodecsInitialised } from "@/lib/codec-init.ts";
import {
  detectImageFormat,
  formatToContentType,
  type ImageFormat,
} from "@/lib/detect-format.ts";
import { resolveDimensions } from "@/lib/dimensions.ts";
import {
  FetchImageError,
  fetchRemoteImage,
} from "@/lib/image-fetcher.ts";
import {
  decodeImage,
  encodeImage,
  resizeImage,
} from "@/lib/image-processor.ts";
import { generateThumbHash } from "@/lib/thumbhash.ts";

const app = new Hono();

const parseDimensionParam = (
  value: string | undefined | null,
): number | undefined => {
  if (value === undefined || value === null || value === "") {
    return undefined;
  }
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return undefined;
  }
  return parsed;
};

const detectSupportedFormat = (
  buffer: ArrayBuffer,
  contentType: string | null,
): ImageFormat | null => {
  return detectImageFormat(new Uint8Array(buffer), contentType);
};

const parseTargetFormatParam = (
  value: string | undefined | null,
): ImageFormat | null => {
  if (!value) {
    return null;
  }
  const normalised = value.trim().toLowerCase();
  switch (normalised) {
    case "jpeg":
    case "jpg":
      return "jpeg";
    case "png":
      return "png";
    case "webp":
      return "webp";
    case "avif":
      return "avif";
    default:
      return null;
  }
};

const CACHE_HEADER_VALUE = "public, max-age=31536000";

const transformHandler = async (c: Context) => {
  const url = c.req.query("url");
  if (!url) {
    return c.json({ error: "Missing url parameter." }, 400);
  }

  const rawWidth = c.req.query("width");
  const rawHeight = c.req.query("height");
  const widthParam = parseDimensionParam(rawWidth);
  const heightParam = parseDimensionParam(rawHeight);

  if (rawWidth && widthParam === undefined) {
    return c.json({ error: "Invalid width parameter." }, 400);
  }

  if (rawHeight && heightParam === undefined) {
    return c.json({ error: "Invalid height parameter." }, 400);
  }

  const formatParam = c.req.query("format");
  const requestedTargetFormat = parseTargetFormatParam(formatParam);
  if (formatParam && !requestedTargetFormat) {
    return c.json({ error: "Unsupported output format requested." }, 400);
  }

  let remote;
  try {
    remote = await fetchRemoteImage(url);
  } catch (error) {
    if (error instanceof FetchImageError) {
      return c.json({ error: error.message }, error.status ?? 502);
    }
    console.error(error);
    return c.json({ error: "Unexpected error fetching image." }, 502);
  }

  const sourceFormat = detectSupportedFormat(remote.buffer, remote.contentType);

  if (!sourceFormat) {
    const headers = new Headers({
      "Cache-Control": CACHE_HEADER_VALUE,
    });
    headers.set(
      "Content-Type",
      remote.contentType ?? "application/octet-stream",
    );
    headers.set("Content-Length", remote.buffer.byteLength.toString());
    return new Response(remote.buffer, { status: 200, headers });
  }

  const shouldReturnOriginal =
    widthParam === undefined &&
    heightParam === undefined &&
    (!requestedTargetFormat || requestedTargetFormat === sourceFormat);

  if (shouldReturnOriginal) {
    const headers = new Headers({
      "Content-Type": remote.contentType ?? formatToContentType(sourceFormat),
      "Cache-Control": CACHE_HEADER_VALUE,
    });
    headers.set("Content-Length", remote.buffer.byteLength.toString());
    return new Response(remote.buffer, { status: 200, headers });
  }

  try {
    await ensureCodecsInitialised();
  } catch (error) {
    console.error("Failed to initialise codecs", error);
    return c.json({ error: "Failed to prepare image codecs." }, 500);
  }

  let decoded: ImageData;
  try {
    decoded = await decodeImage(remote.buffer, sourceFormat);
  } catch (error) {
    console.error("Failed to decode image", error);
    return c.json({ error: "Failed to decode source image." }, 422);
  }

  const needsResize = widthParam !== undefined || heightParam !== undefined;

  let targetWidth = decoded.width;
  let targetHeight = decoded.height;
  if (needsResize) {
    try {
      const target = resolveDimensions(
        { width: decoded.width, height: decoded.height },
        { width: widthParam, height: heightParam },
      );
      targetWidth = target.width;
      targetHeight = target.height;
    } catch (error) {
      return c.json({
        error: error instanceof Error
          ? error.message
          : "Invalid resize parameters.",
      }, 400);
    }
  }

  let resized = decoded;
  if (needsResize) {
    try {
      resized = await resizeImage(decoded, targetWidth, targetHeight);
    } catch (error) {
      console.error("Failed to resize image", error);
      return c.json({ error: "Unable to resize image with the given parameters." }, 422);
    }
  }

  const targetFormat: ImageFormat = requestedTargetFormat ?? sourceFormat;

  let encoded: ArrayBuffer;
  try {
    encoded = await encodeImage(resized, targetFormat);
  } catch (error) {
    console.error("Failed to encode image", error);
    return c.json({ error: "Failed to encode resized image." }, 500);
  }

  const headers = new Headers({
    "Content-Type": formatToContentType(targetFormat),
    "Cache-Control": CACHE_HEADER_VALUE,
  });
  headers.set("Content-Length", encoded.byteLength.toString());

  return new Response(encoded, { status: 200, headers });
};

const metaHandler = async (c: Context) => {
  const url = c.req.query("url");
  if (!url) {
    return c.json({ error: "Missing url parameter." }, 400);
  }

  let remote;
  try {
    remote = await fetchRemoteImage(url);
  } catch (error) {
    if (error instanceof FetchImageError) {
      return c.json({ error: error.message }, error.status ?? 502);
    }
    console.error(error);
    return c.json({ error: "Unexpected error fetching image." }, 502);
  }

  try {
    await ensureCodecsInitialised();
  } catch (error) {
    console.error("Failed to initialise codecs", error);
    return c.json({ error: "Failed to prepare image codecs." }, 500);
  }

  const format = detectSupportedFormat(remote.buffer, remote.contentType);
  if (!format) {
    return c.json({ error: "Unsupported image format." }, 415);
  }

  let decoded: ImageData;
  try {
    decoded = await decodeImage(remote.buffer, format);
  } catch (error) {
    console.error("Failed to decode image", error);
    return c.json({ error: "Failed to decode source image." }, 422);
  }

  let thumbHash: string | null = null;
  try {
    thumbHash = await generateThumbHash(decoded);
  } catch (error) {
    console.error("Failed to generate thumbhash", error);
  }

  c.header("Cache-Control", CACHE_HEADER_VALUE);
  return c.json({
    width: decoded.width,
    height: decoded.height,
    thumbHash,
  });
};

app.get("/", transformHandler);
app.get("/image-transformer", transformHandler);
app.get("/image-transformer/", transformHandler);

app.get("/meta", metaHandler);
app.get("/meta/", metaHandler);
app.get("/image-transformer/meta", metaHandler);
app.get("/image-transformer/meta/", metaHandler);

Deno.serve(app.fetch);
