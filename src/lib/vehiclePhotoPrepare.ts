/**
 * Preparo seguro da foto do veículo escolhida na galeria.
 *
 * Por que existe: a checagem antiga abria a foto INTEIRA num <img> só para validá-la e recusava mais de 40 MP. No Android o WebView
 * limita o tamanho que aceita decodificar conforme a memória do aparelho e fotos de câmeras de 48/50/64/108 MP (ou HEIC) viravam
 * "VEHICLE_PHOTO_DECODE_INVALID" — por isso "para alguns funciona e para outros não". Aqui a foto nunca é decodificada no tamanho original:
 *
 *   1. lê só o cabeçalho (tipo real, largura, altura e orientação EXIF) sem confiar em `file.type`;
 *   2. JPEG: `ImageDecoder` já na escala reduzida (n/8) — memória ~25× menor que decodificar tudo;
 *   3. demais formatos / WebView antigo: `createImageBitmap` com redução, limitado pela memória do aparelho;
 *   4. último recurso: <img>;
 *   5. desenha no tamanho final (máx. 1280 px), gera WebP (JPEG se o WebView não gravar WebP) dentro do limite de bytes e a miniatura.
 *
 * Toda falha vira uma mensagem clara em português (com o código técnico em `error.code`). Nada aqui toca rede nem armazenamento.
 */

/** Foto original aceita: 20 MB (a decodificação é em fluxo e reduzida, o que sobe para o Storage continua < 2 MB). */
export const PHOTO_MAX_SOURCE_BYTES = 20 * 1024 * 1024;
/** Teto absoluto de pixels declarados no cabeçalho (barra imagens "bomba" que declaram dimensões absurdas). */
export const PHOTO_MAX_SOURCE_PIXELS = 300_000_000;
const HEADER_FIRST_READ = 262_144;
const HEADER_MAX_READ = 4_194_304;
const PREPARE_TIMEOUT_MS = 45_000;

export type PhotoFormat = "jpeg" | "png" | "webp" | "gif" | "bmp" | "avif" | "heic" | "unknown";
export type PhotoErrorCode =
  | "VEHICLE_PHOTO_EMPTY" | "VEHICLE_PHOTO_UNREADABLE" | "VEHICLE_PHOTO_TOO_LARGE" | "VEHICLE_PHOTO_NOT_IMAGE" | "VEHICLE_PHOTO_HEIC_UNSUPPORTED"
  | "VEHICLE_PHOTO_RESOLUTION_UNSUPPORTED" | "VEHICLE_PHOTO_DECODE_INVALID" | "VEHICLE_PHOTO_ENCODE_FAILED" | "VEHICLE_PHOTO_TIMEOUT" | "VEHICLE_PHOTO_DECODE_UNAVAILABLE";

export type PhotoProbe = { format: PhotoFormat; mime: string; width: number; height: number; orientation: number; bytes: number };
export type PhotoDetail = Partial<PhotoProbe> & { megapixels?: number; via?: string; reasons?: string[]; cause?: unknown };

const MIME: Record<PhotoFormat, string> = { jpeg: "image/jpeg", png: "image/png", webp: "image/webp", gif: "image/gif", bmp: "image/bmp", avif: "image/avif", heic: "image/heic", unknown: "" };
/** MB com uma casa; `up` arredonda para cima (assim "20 MB e meio byte" nunca aparece como "20 MB" contra um limite de 20 MB). */
const megabytes = (bytes: number, up = false) => { const value = bytes / 1_048_576; return (up ? Math.ceil(value * 10) / 10 : value).toLocaleString("pt-BR", { maximumFractionDigits: 1 }); };

function messageFor(code: PhotoErrorCode, detail: PhotoDetail): string {
  const what = detail.format && detail.format !== "unknown" && detail.width && detail.height
    ? ` (${detail.format.toUpperCase()} ${detail.width}×${detail.height}, ${megabytes(detail.bytes || 0)} MB)` : detail.bytes ? ` (${megabytes(detail.bytes)} MB)` : "";
  switch (code) {
    case "VEHICLE_PHOTO_EMPTY":
    case "VEHICLE_PHOTO_UNREADABLE": return "Não foi possível ler esta foto. Se ela está na nuvem (Google Fotos), baixe-a no aparelho e escolha de novo.";
    case "VEHICLE_PHOTO_TOO_LARGE": return `A foto tem ${megabytes(detail.bytes || 0, true)} MB e o limite é ${megabytes(PHOTO_MAX_SOURCE_BYTES)} MB. Escolha outra foto ou use uma resolução menor na câmera.`;
    case "VEHICLE_PHOTO_NOT_IMAGE": return "O arquivo escolhido não é uma imagem compatível. Use uma foto JPG, PNG ou WEBP.";
    case "VEHICLE_PHOTO_HEIC_UNSUPPORTED": return "Esta foto está no formato HEIC/HEIF, que o app não consegue abrir neste aparelho. Escolha uma foto em JPG ou PNG (nas configurações da câmera, desative “Fotos de alta eficiência”).";
    case "VEHICLE_PHOTO_RESOLUTION_UNSUPPORTED": return `Esta foto tem resolução muito alta${detail.megapixels ? ` (${Math.round(detail.megapixels)} megapixels)` : ""} para este aparelho. Escolha uma foto de menor resolução.`;
    case "VEHICLE_PHOTO_ENCODE_FAILED": return "Não foi possível preparar esta foto neste aparelho. Tente outra foto.";
    case "VEHICLE_PHOTO_TIMEOUT": return "A foto demorou demais para ser preparada neste aparelho. Tente uma foto menor.";
    case "VEHICLE_PHOTO_DECODE_UNAVAILABLE": return "Este navegador não consegue preparar fotos.";
    default: return `Não foi possível abrir esta foto${what}. O arquivo pode estar corrompido ou em formato incompatível. Escolha outra foto.`;
  }
}

export class PhotoPrepareError extends Error {
  readonly code: PhotoErrorCode;
  readonly detail: PhotoDetail;
  constructor(code: PhotoErrorCode, detail: PhotoDetail = {}) {
    super(messageFor(code, detail), detail.cause ? { cause: detail.cause } : undefined);
    this.name = "PhotoPrepareError"; this.code = code; this.detail = detail;
  }
}

// ───────────────────────────── cabeçalho ─────────────────────────────

async function readBytes(blob: Blob, start: number, end: number): Promise<Uint8Array> {
  const part = blob.slice(start, end);
  try {
    if (typeof part.arrayBuffer === "function") return new Uint8Array(await part.arrayBuffer());
    return new Uint8Array(await new Promise<ArrayBuffer>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result as ArrayBuffer); reader.onerror = () => reject(reader.error || new Error("read-failed"));
      reader.readAsArrayBuffer(part);
    }));
  } catch (cause) { throw new PhotoPrepareError("VEHICLE_PHOTO_UNREADABLE", { cause }); }
}

const ascii = (bytes: Uint8Array, at: number, length: number) => { let text = ""; for (let i = 0; i < length && at + i < bytes.length; i++) text += String.fromCharCode(bytes[at + i]); return text; };
const u16be = (b: Uint8Array, o: number) => (b[o] << 8) | b[o + 1];
const u32be = (b: Uint8Array, o: number) => ((b[o] << 24) | (b[o + 1] << 16) | (b[o + 2] << 8) | b[o + 3]) >>> 0;
const u16le = (b: Uint8Array, o: number) => b[o] | (b[o + 1] << 8);
const u32le = (b: Uint8Array, o: number) => (b[o] | (b[o + 1] << 8) | (b[o + 2] << 16) | (b[o + 3] << 24)) >>> 0;

/** Orientação EXIF (1–8) do bloco APP1; 1 quando não há. Toda leitura é limitada ao bloco. */
export function exifOrientation(bytes: Uint8Array, start: number, end: number): number {
  if (end > bytes.length || start + 14 > end || ascii(bytes, start, 6) !== "Exif\0\0") return 1;
  const tiff = start + 6, big = bytes[tiff] === 0x4d && bytes[tiff + 1] === 0x4d;
  if (!big && !(bytes[tiff] === 0x49 && bytes[tiff + 1] === 0x49)) return 1;
  const u16 = (o: number) => big ? u16be(bytes, o) : u16le(bytes, o), u32 = (o: number) => big ? u32be(bytes, o) : u32le(bytes, o);
  if (u16(tiff + 2) !== 42) return 1;
  const ifd = tiff + u32(tiff + 4);
  if (ifd < tiff || ifd + 2 > end) return 1;
  const count = Math.min(u16(ifd), 64);
  for (let i = 0; i < count; i++) {
    const entry = ifd + 2 + i * 12;
    if (entry + 12 > end) return 1;
    if (u16(entry) === 0x0112) { const value = u16(entry + 8); return value >= 1 && value <= 8 ? value : 1; }
  }
  return 1;
}

async function probeJpeg(blob: Blob, first: Uint8Array): Promise<{ width: number; height: number; orientation: number }> {
  let buffer = first, orientation = 1, offset = 2;
  const ensure = async (end: number) => {
    if (end <= buffer.length || buffer.length >= blob.size || buffer.length >= HEADER_MAX_READ) return;
    buffer = await readBytes(blob, 0, Math.min(blob.size, HEADER_MAX_READ, Math.max(end, buffer.length * 2)));
  };
  for (let guard = 0; guard < 600; guard++) {
    await ensure(offset + 4);
    if (offset + 4 > buffer.length) break;
    if (buffer[offset] !== 0xff) { offset++; continue; }
    const marker = buffer[offset + 1];
    if (marker === 0xff) { offset++; continue; }
    if (marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) { offset += 2; continue; }
    if (marker === 0xd9 || marker === 0xda) break;
    const length = u16be(buffer, offset + 2);
    if (length < 2) break;
    if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
      await ensure(offset + 9);
      if (offset + 9 > buffer.length) break;
      return { height: u16be(buffer, offset + 5), width: u16be(buffer, offset + 7), orientation };
    }
    if (marker === 0xe1) { await ensure(offset + 2 + length); orientation = exifOrientation(buffer, offset + 4, Math.min(buffer.length, offset + 2 + length)) || orientation; }
    offset += 2 + length;
  }
  return { width: 0, height: 0, orientation };
}

function probeWebp(b: Uint8Array): { width: number; height: number } {
  const kind = ascii(b, 12, 4);
  if (kind === "VP8 " && b.length >= 30) return { width: u16le(b, 26) & 0x3fff, height: u16le(b, 28) & 0x3fff };
  if (kind === "VP8L" && b.length >= 25 && b[20] === 0x2f) { const bits = u32le(b, 21); return { width: (bits & 0x3fff) + 1, height: ((bits >>> 14) & 0x3fff) + 1 }; }
  if (kind === "VP8X" && b.length >= 30) return { width: (b[24] | (b[25] << 8) | (b[26] << 16)) + 1, height: (b[27] | (b[28] << 8) | (b[29] << 16)) + 1 };
  return { width: 0, height: 0 };
}

function probeIso(b: Uint8Array): { format: PhotoFormat; width: number; height: number } {
  const size = Math.min(u32be(b, 0) || 32, 128), brands = [ascii(b, 8, 4)];
  for (let at = 16; at + 4 <= size && at + 4 <= b.length; at += 4) brands.push(ascii(b, at, 4));
  const format: PhotoFormat = brands.some(brand => brand === "avif" || brand === "avis") ? "avif"
    : brands.some(brand => ["heic", "heix", "hevc", "hevx", "heim", "heis", "hevm", "hevs", "mif1", "msf1", "heif"].includes(brand)) ? "heic" : "unknown";
  for (let at = 0; at + 16 <= Math.min(b.length, 65_536); at++) {
    if (b[at] === 0x69 && b[at + 1] === 0x73 && b[at + 2] === 0x70 && b[at + 3] === 0x65) return { format, width: u32be(b, at + 8), height: u32be(b, at + 12) };
  }
  return { format, width: 0, height: 0 };
}

/** Tipo real, dimensões e orientação lidos do cabeçalho (nunca do `file.type`). Não decodifica a imagem. */
export async function probePhoto(blob: Blob): Promise<PhotoProbe> {
  const head = await readBytes(blob, 0, Math.min(blob.size, HEADER_FIRST_READ));
  const base = { bytes: blob.size, orientation: 1 };
  const done = (format: PhotoFormat, width: number, height: number, orientation = 1): PhotoProbe => ({ format, mime: MIME[format], width, height, orientation, bytes: base.bytes });
  if (head.length >= 3 && head[0] === 0xff && head[1] === 0xd8 && head[2] === 0xff) { const info = await probeJpeg(blob, head); return done("jpeg", info.width, info.height, info.orientation); }
  if (head.length >= 24 && head[0] === 0x89 && ascii(head, 1, 3) === "PNG") return done("png", u32be(head, 16), u32be(head, 20));
  if (head.length >= 12 && ascii(head, 0, 4) === "RIFF" && ascii(head, 8, 4) === "WEBP") { const size = probeWebp(head); return done("webp", size.width, size.height); }
  if (head.length >= 10 && ascii(head, 0, 3) === "GIF") return done("gif", u16le(head, 6), u16le(head, 8));
  if (head.length >= 26 && head[0] === 0x42 && head[1] === 0x4d) return done("bmp", u32le(head, 18), Math.abs(u32le(head, 22) | 0));
  if (head.length >= 16 && ascii(head, 4, 4) === "ftyp") { const info = probeIso(head); if (info.format !== "unknown") return done(info.format, info.width, info.height); }
  return done("unknown", 0, 0);
}

// ───────────────────────────── decodificação ─────────────────────────────

type Decoded = { source: CanvasImageSource; width: number; height: number; via: "image-decoder" | "image-bitmap" | "img-element"; dispose: () => void };
type Size = { width: number; height: number };

const swapsAxes = (orientation: number) => orientation >= 5 && orientation <= 8;
const orientedSize = (probe: PhotoProbe): Size => swapsAxes(probe.orientation) ? { width: probe.height, height: probe.width } : { width: probe.width, height: probe.height };
const fitInside = (size: Size, maxSide: number): Size => {
  const scale = Math.min(1, maxSide / Math.max(size.width, size.height));
  return { width: Math.max(1, Math.round(size.width * scale)), height: Math.max(1, Math.round(size.height * scale)) };
};

/** Pixels que dá para decodificar por inteiro com folga conforme a memória do aparelho (~13 milhões por GB, entre 16 e 100 milhões). */
export function fullDecodePixelCap(deviceMemoryGb?: number): number {
  const memory = Number.isFinite(deviceMemoryGb) && (deviceMemoryGb as number) > 0 ? (deviceMemoryGb as number) : 4;
  return Math.min(100_000_000, Math.max(16_000_000, Math.round(memory * 13_000_000)));
}
const currentCap = () => fullDecodePixelCap(typeof navigator !== "undefined" ? (navigator as { deviceMemory?: number }).deviceMemory : undefined);

/** JPEG na escala reduzida n/8 (menor n que ainda dá o tamanho final): decodifica ~25× menos memória que a foto inteira. */
async function decodeJpegScaled(blob: Blob, probe: PhotoProbe, maxSide: number): Promise<Decoded> {
  const scope = globalThis as unknown as { ImageDecoder?: any; VideoFrame?: any };
  if (typeof scope.ImageDecoder !== "function" || typeof scope.VideoFrame !== "function" || !("rotation" in scope.VideoFrame.prototype)) throw new Error("image-decoder-unavailable");
  if (typeof scope.ImageDecoder.isTypeSupported === "function" && !(await scope.ImageDecoder.isTypeSupported("image/jpeg"))) throw new Error("image-decoder-jpeg-unsupported");
  if (typeof blob.stream !== "function") throw new Error("blob-stream-unavailable");
  const longSide = Math.max(probe.width, probe.height), wanted = Math.min(longSide, maxSide);
  let numerator = Math.min(8, Math.max(1, Math.ceil(wanted * 8 / longSide)));
  for (let attempt = 0; attempt < 2; attempt++, numerator++) {
    const decoder = new scope.ImageDecoder({ data: blob.stream(), type: "image/jpeg", preferAnimation: false,
      desiredWidth: Math.ceil(probe.width * numerator / 8), desiredHeight: Math.ceil(probe.height * numerator / 8) });
    try {
      const { image } = await decoder.decode({ frameIndex: 0 });
      if (Math.max(image.displayWidth, image.displayHeight) < wanted * 0.98 && numerator < 8) { image.close(); continue; }
      return { source: image, width: image.displayWidth, height: image.displayHeight, via: "image-decoder", dispose: () => { try { image.close(); } catch { /* já fechada */ } } };
    } finally { try { decoder.close(); } catch { /* já fechado */ } }
  }
  throw new Error("jpeg-scale-not-reached");
}

async function decodeWithBitmap(blob: Blob, target: Size | null): Promise<Decoded> {
  if (typeof createImageBitmap !== "function") throw new Error("create-image-bitmap-unavailable");
  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(blob, { imageOrientation: "from-image", ...(target ? { resizeWidth: target.width, resizeHeight: target.height, resizeQuality: "high" } : {}) } as ImageBitmapOptions);
  } catch (error) {
    if (!(error instanceof TypeError)) throw error;
    bitmap = await createImageBitmap(blob); // WebView antigo que não conhece essas opções
  }
  return { source: bitmap, width: bitmap.width, height: bitmap.height, via: "image-bitmap", dispose: () => { try { bitmap.close(); } catch { /* já fechado */ } } };
}

async function decodeWithImage(blob: Blob): Promise<Decoded> {
  if (typeof Image === "undefined" || typeof URL === "undefined") throw new Error("img-unavailable");
  const url = URL.createObjectURL(blob), image = new Image();
  try {
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error("img-timeout")), 15_000);
      image.onload = () => { clearTimeout(timer); resolve(); };
      image.onerror = () => { clearTimeout(timer); reject(new Error("img-error")); };
      image.src = url;
    });
    if (!(image.naturalWidth > 0 && image.naturalHeight > 0)) throw new Error("img-empty");
    return { source: image, width: image.naturalWidth, height: image.naturalHeight, via: "img-element", dispose: () => URL.revokeObjectURL(url) };
  } catch (error) { URL.revokeObjectURL(url); throw error; }
}

async function decodePhoto(blob: Blob, probe: PhotoProbe, maxSide: number, reasons: string[]): Promise<Decoded> {
  const pixels = probe.width * probe.height, known = pixels > 0, cap = currentCap();
  const oriented = known ? orientedSize(probe) : null;
  if (probe.format === "jpeg" && known) {
    try { return await decodeJpegScaled(blob, probe, maxSide); } catch (error) { reasons.push(`scaled:${(error as Error)?.message || error}`); }
  }
  if (!known || pixels <= cap) {
    try { return await decodeWithBitmap(blob, oriented ? fitInside(oriented, maxSide) : null); } catch (error) { reasons.push(`bitmap:${(error as Error)?.message || error}`); }
    try { return await decodeWithImage(blob); } catch (error) { reasons.push(`img:${(error as Error)?.message || error}`); }
  } else reasons.push(`cap:${pixels}>${cap}`);
  if (probe.format === "heic") throw new PhotoPrepareError("VEHICLE_PHOTO_HEIC_UNSUPPORTED", { ...probe, reasons });
  if (known && pixels > cap) throw new PhotoPrepareError("VEHICLE_PHOTO_RESOLUTION_UNSUPPORTED", { ...probe, megapixels: pixels / 1_000_000, reasons });
  throw new PhotoPrepareError("VEHICLE_PHOTO_DECODE_INVALID", { ...probe, reasons });
}

// ───────────────────────────── saída ─────────────────────────────

type AnyCanvas = HTMLCanvasElement | OffscreenCanvas;
function makeCanvas(width: number, height: number): AnyCanvas {
  if (typeof OffscreenCanvas === "function") { try { return new OffscreenCanvas(width, height); } catch { /* usa o canvas do documento */ } }
  if (typeof document !== "undefined") { const canvas = document.createElement("canvas"); canvas.width = width; canvas.height = height; return canvas; }
  throw new PhotoPrepareError("VEHICLE_PHOTO_DECODE_UNAVAILABLE");
}
async function encodeCanvas(canvas: AnyCanvas, type: string, quality: number): Promise<Blob | null> {
  if (typeof (canvas as OffscreenCanvas).convertToBlob === "function") return (canvas as OffscreenCanvas).convertToBlob({ type, quality });
  return new Promise(resolve => (canvas as HTMLCanvasElement).toBlob(resolve, type, quality));
}
function drawScaled(decoded: Decoded, size: Size, flatten: boolean): AnyCanvas {
  const canvas = makeCanvas(size.width, size.height), context = canvas.getContext("2d") as CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D | null;
  if (!context) throw new PhotoPrepareError("VEHICLE_PHOTO_ENCODE_FAILED");
  if (flatten) { context.fillStyle = "#fff"; context.fillRect(0, 0, size.width, size.height); }
  context.imageSmoothingEnabled = true; context.imageSmoothingQuality = "high";
  context.drawImage(decoded.source, 0, 0, size.width, size.height);
  return canvas;
}
const blobToDataUrl = (blob: Blob) => new Promise<string>((resolve, reject) => {
  const reader = new FileReader();
  reader.onload = () => resolve(String(reader.result || "")); reader.onerror = () => reject(reader.error || new Error("read-failed"));
  reader.readAsDataURL(blob);
});

export type PrepareOptions = {
  /** Maior lado da foto final (padrão 1280 px). */
  maxSide?: number;
  /** Tamanho alvo da foto final em bytes (padrão 800 KB). */
  targetBytes?: number;
  /** Miniatura JPEG; `false` não gera. Padrão 480×320, qualidade 0,65. */
  poster?: false | { maxWidth?: number; maxHeight?: number; quality?: number };
  /** Foto já otimizada (ex.: baixada do Storage): devolve os mesmos bytes quando a regra aceitar. */
  keepOriginal?: (probe: PhotoProbe) => boolean;
  /** Tempo máximo do preparo (padrão 45 s). */
  timeoutMs?: number;
};
export type PreparedPhoto = { blob: Blob; width: number; height: number; posterDataUrl: string; probe: PhotoProbe; via: Decoded["via"] | "original" };

async function prepare(file: Blob, options: PrepareOptions): Promise<PreparedPhoto> {
  const maxSide = options.maxSide || 1280, targetBytes = options.targetBytes || 800_000;
  if (!file.size) throw new PhotoPrepareError("VEHICLE_PHOTO_EMPTY");
  if (file.size > PHOTO_MAX_SOURCE_BYTES) throw new PhotoPrepareError("VEHICLE_PHOTO_TOO_LARGE", { bytes: file.size });
  const probe = await probePhoto(file);
  if (probe.format === "unknown") throw new PhotoPrepareError("VEHICLE_PHOTO_NOT_IMAGE", probe);
  if (probe.width * probe.height > PHOTO_MAX_SOURCE_PIXELS) throw new PhotoPrepareError("VEHICLE_PHOTO_RESOLUTION_UNSUPPORTED", { ...probe, megapixels: probe.width * probe.height / 1_000_000 });
  const reasons: string[] = [];
  const decoded = await decodePhoto(file, probe, maxSide, reasons);
  try {
    const natural = { width: decoded.width, height: decoded.height };
    const size = fitInside(natural, maxSide);
    let blob: Blob | null = null, kept = false;
    if (options.keepOriginal?.(probe) && ["jpeg", "png", "webp"].includes(probe.format)) {
      blob = file.type === probe.mime ? file : file.slice(0, file.size, probe.mime); kept = true;
    } else {
      let current = size, quality = 0.85, type = "image/webp";
      for (let attempt = 0; attempt < 8; attempt++) {
        let encoded = await encodeCanvas(drawScaled(decoded, current, type === "image/jpeg"), type, quality);
        if (encoded && encoded.type !== type && type === "image/webp") { type = "image/jpeg"; encoded = await encodeCanvas(drawScaled(decoded, current, true), type, quality); }
        if (!encoded || !encoded.size) throw new PhotoPrepareError("VEHICLE_PHOTO_ENCODE_FAILED", { ...probe, reasons });
        blob = encoded;
        if (encoded.size <= targetBytes) break;
        if (quality > 0.55) quality = Math.max(0.5, quality - 0.12);
        else current = { width: Math.max(1, Math.round(current.width * 0.85)), height: Math.max(1, Math.round(current.height * 0.85)) };
      }
    }
    if (!blob) throw new PhotoPrepareError("VEHICLE_PHOTO_ENCODE_FAILED", { ...probe, reasons });
    let posterDataUrl = "";
    if (options.poster !== false) {
      const poster = options.poster || {}, maxWidth = poster.maxWidth || 480, maxHeight = poster.maxHeight || 320;
      const ratio = Math.min(1, natural.width > natural.height ? maxWidth / natural.width : maxHeight / natural.height);
      const posterBlob = await encodeCanvas(drawScaled(decoded, { width: Math.max(1, Math.round(natural.width * ratio)), height: Math.max(1, Math.round(natural.height * ratio)) }, true), "image/jpeg", poster.quality ?? 0.65);
      if (!posterBlob) throw new PhotoPrepareError("VEHICLE_PHOTO_ENCODE_FAILED", { ...probe, reasons });
      posterDataUrl = await blobToDataUrl(posterBlob);
    }
    return { blob, width: kept ? natural.width : size.width, height: kept ? natural.height : size.height, posterDataUrl, probe, via: kept ? "original" : decoded.via };
  } finally { decoded.dispose(); }
}

function withTimeout<T>(work: Promise<T>, ms: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout>;
  return Promise.race([work, new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new PhotoPrepareError("VEHICLE_PHOTO_TIMEOUT")), ms); })]).finally(() => clearTimeout(timer));
}

/** Prepara a foto escolhida (até 20 MB, qualquer resolução razoável): devolve a imagem final, a miniatura e como foi lida. */
export async function preparePhoto(file: Blob, options: PrepareOptions = {}): Promise<PreparedPhoto> {
  try { return await withTimeout(prepare(file, options), options.timeoutMs || PREPARE_TIMEOUT_MS); }
  catch (error) {
    const failure = error instanceof PhotoPrepareError ? error : new PhotoPrepareError("VEHICLE_PHOTO_DECODE_INVALID", { bytes: file.size, cause: error });
    // Diagnóstico para o suporte: o código e o que foi tentado ficam no console do aparelho; a tela mostra só a mensagem.
    try { console.warn("[NVU] Foto do veículo:", { code: failure.code, format: failure.detail.format, width: failure.detail.width, height: failure.detail.height, bytes: failure.detail.bytes ?? file.size, reasons: failure.detail.reasons }); } catch { /* console indisponível */ }
    throw failure;
  }
}
