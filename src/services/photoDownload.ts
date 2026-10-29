import { Capacitor, CapacitorHttp } from "@capacitor/core";
import { vehiclePhotoFailure } from "./vehiclePhotoErrors";

const MAX_BYTES = 10 * 1024 * 1024;
const NATIVE_HOSTS = new Set([
  "firebasestorage.googleapis.com", "storage.googleapis.com", "res.cloudinary.com",
  "lh3.googleusercontent.com", "lh4.googleusercontent.com", "lh5.googleusercontent.com", "lh6.googleusercontent.com",
]);

function nativeUrl(value: string): URL {
  const url = new URL(value);
  if (url.protocol !== "https:" || url.username || url.password || (url.port && url.port !== "443") || !NATIVE_HOSTS.has(url.hostname)) {
    throw new Error("VEHICLE_PHOTO_DOWNLOAD_HOST_NOT_ALLOWED");
  }
  return url;
}

function header(headers: Record<string, string>, name: string): string {
  return Object.entries(headers).find(([key]) => key.toLowerCase() === name)?.[1] || "";
}

async function checkedBlob(blob: Blob): Promise<Blob> {
  if (!blob.size || blob.size > MAX_BYTES) throw new Error("VEHICLE_PHOTO_DOWNLOAD_INVALID");
  if (blob.type.startsWith("image/")) return blob;
  // Some older uploads have a generic binary MIME despite containing a photo.
  const bytes = new Uint8Array(await blob.slice(0, 32).arrayBuffer());
  const text = String.fromCharCode(...bytes);
  const type = bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff ? "image/jpeg"
    : text.startsWith("\x89PNG\r\n\x1a\n") ? "image/png"
    : text.startsWith("RIFF") && text.slice(8, 12) === "WEBP" ? "image/webp"
    : /^GIF8[79]a/.test(text) ? "image/gif"
    : text.slice(4, 8) === "ftyp" && /avif|avis/.test(text.slice(8)) ? "image/avif" : "";
  if (!type || (blob.type && blob.type !== "application/octet-stream" && blob.type !== "binary/octet-stream")) throw new Error("VEHICLE_PHOTO_DOWNLOAD_INVALID");
  return new Blob([blob], { type });
}

async function nativeDownload(value: string, preferCache = false): Promise<Blob> {
  let url = nativeUrl(value).href;
  for (let redirects = 0; redirects <= 3; redirects++) {
    const response = await CapacitorHttp.get({
      url, responseType: "arraybuffer", disableRedirects: true,
      headers: preferCache ? {} : { "Cache-Control": "no-cache" },
      connectTimeout: 10_000, readTimeout: 10_000,
    });
    if (response.url) nativeUrl(response.url);
    if ([301, 302, 303, 307, 308].includes(response.status)) {
      const location = header(response.headers, "location");
      if (!location || redirects === 3) throw new Error("VEHICLE_PHOTO_DOWNLOAD_REDIRECT_INVALID");
      url = nativeUrl(new URL(location, url).href).href;
      continue;
    }
    if (response.status < 200 || response.status >= 300) throw new Error(`VEHICLE_PHOTO_DOWNLOAD_HTTP_${response.status}`);
    if (Number(header(response.headers, "content-length")) > MAX_BYTES || typeof response.data !== "string" || response.data.length > Math.ceil(MAX_BYTES / 3) * 4 + 500_000) {
      throw new Error("VEHICLE_PHOTO_DOWNLOAD_INVALID");
    }
    // Capacitor's Android arraybuffer response is base64, including line breaks.
    const binary = atob(response.data.replace(/\s/g, ""));
    if (binary.length > MAX_BYTES) throw new Error("VEHICLE_PHOTO_DOWNLOAD_INVALID");
    return checkedBlob(new Blob([Uint8Array.from(binary, (char) => char.charCodeAt(0))], { type: header(response.headers, "content-type").split(";")[0].trim().toLowerCase() }));
  }
  throw new Error("VEHICLE_PHOTO_DOWNLOAD_REDIRECT_INVALID");
}

/** Download bytes explicitly. Rendering a remote <img> does not save a photo. */
export async function downloadPhotoBlob(value: string, options: { preferCache?: boolean } = {}): Promise<Blob> {
  try {
    let approved = false;
    try { nativeUrl(value); approved = true; } catch { /* Web fetch still supports CORS-enabled providers. */ }
    if (approved && Capacitor.isNativePlatform()) {
      let timer: ReturnType<typeof setTimeout> | undefined;
      try {
        return await Promise.race([
          nativeDownload(value, options.preferCache),
          new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error("VEHICLE_PHOTO_DOWNLOAD_TIMEOUT")), 20_000); }),
        ]);
      } finally { if (timer) clearTimeout(timer); }
    }
    const response = await fetch(value, { cache: options.preferCache ? "force-cache" : "no-store", signal: AbortSignal.timeout(20_000) });
    if (!response.ok) throw new Error(`VEHICLE_PHOTO_DOWNLOAD_HTTP_${response.status}`);
    if (Number(response.headers.get("content-length")) > MAX_BYTES) throw new Error("VEHICLE_PHOTO_DOWNLOAD_INVALID");
    return await checkedBlob(await response.blob());
  } catch (error) { throw vehiclePhotoFailure(error, "download"); }
}
