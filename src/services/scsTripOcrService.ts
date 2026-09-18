const LOCAL_TESSDATA_PATH = "/tessdata";
const REFERENCE_ASPECT_RATIO = 16 / 9;

export interface ScsTripOcrResult {
  origin: string | null;
  destination: string | null;
  distanceKm: number | null;
  value: string | null;
  sourceDistanceUnit: "km" | "mi" | null;
}

interface DecodedImage {
  source: CanvasImageSource;
  width: number;
  height: number;
  cleanup: () => void;
}

interface CropRegion {
  x: number;
  y: number;
  width: number;
  height: number;
  targetWidth: number;
  minScale: number;
  maxScale: number;
}

interface ReferenceViewport {
  x: number;
  y: number;
  width: number;
  height: number;
}

// ATS and ETS2 share the SCS delivery-summary layout. These crops are based on
// the centered 16:9 game viewport instead of the raw screenshot width, so the
// same regions also remain usable when a wider monitor adds side space.
const ROUTE_CROP: CropRegion = {
  x: 0.19,
  y: 0.19,
  width: 0.62,
  height: 0.075,
  targetWidth: 2200,
  minScale: 2,
  maxScale: 3.2,
};

// Desktop SCS installations can use a different UI scale from screenshots
// transferred to a phone. The reward table is bottom-anchored (which is why
// value OCR kept working), while the route/status block can move vertically.
// Keep the proven mobile crop above and add a wider desktop-safe candidate.
const ROUTE_DESKTOP_CROP: CropRegion = {
  x: 0.14,
  y: 0.15,
  width: 0.72,
  height: 0.16,
  targetWidth: 2300,
  minScale: 1.8,
  maxScale: 3.2,
};

// Only the value side of the distance row is read. Keeping the label and the
// time row out of this crop materially reduces 1/7 OCR confusion in SCS fonts.
const DISTANCE_CROP: CropRegion = {
  x: 0.599,
  y: 0.249,
  width: 0.117,
  height: 0.049,
  targetWidth: 1080,
  minScale: 4,
  maxScale: 6,
};

// Wider fallback that includes the distance label and value. This is used only
// when the narrow crop misses because the desktop UI scale shifted the row.
const DISTANCE_DESKTOP_CROP: CropRegion = {
  x: 0.30,
  y: 0.20,
  width: 0.46,
  height: 0.16,
  targetWidth: 1900,
  minScale: 2,
  maxScale: 4,
};

// ATS/ETS2 repeat the driven distance in the first row of the reward table.
// Keep a dedicated confirmation crop for that row. Distance is never accepted
// from a broad summary block: the number must be read from a real distance
// field, which prevents unrelated strokes/text from becoming a leading digit.
const DISTANCE_REWARD_CROP: CropRegion = {
  x: 0.39,
  y: 0.45,
  width: 0.16,
  height: 0.045,
  targetWidth: 1100,
  minScale: 3,
  maxScale: 5.5,
};

// Last-resort read of the upper summary area. It is intentionally excluded
// from the normal path so mobile performance remains unchanged.
const SUMMARY_FALLBACK_CROP: CropRegion = {
  x: 0.10,
  y: 0.12,
  width: 0.80,
  height: 0.30,
  targetWidth: 2400,
  minScale: 1.6,
  maxScale: 3,
};

// Only the monetary column of the final Total row is read. The XP column is
// intentionally excluded so it cannot be mistaken for the trip earnings.
const VALUE_CROP: CropRegion = {
  x: 0.535,
  y: 0.715,
  width: 0.13,
  height: 0.07,
  targetWidth: 1100,
  minScale: 3,
  maxScale: 5.5,
};

const replaceLikelyDigitConfusions = (value: string): string =>
  value
    .replace(/[OoQ]/g, "0")
    .replace(/[Il|!]/g, "1")
    .replace(/[Ss]/g, "5")
    .replace(/[Bb]/g, "8");

const cleanOcrLine = (value: string): string =>
  value
    .replace(/[\r\n]+/g, " ")
    .replace(/\s+/g, " ")
    .replace(/^[\s|:;,_-]+|[\s|:;,_-]+$/g, "")
    .trim();

const cleanCityName = (value: string): string | null => {
  const cleaned = value
    .replace(/^[\s:;,.|_\-–—]+|[\s:;,.|_\-–—]+$/g, "")
    .replace(/\s+/g, " ")
    .trim();

  if (cleaned.length < 2 || cleaned.length > 80) return null;
  if (!/[A-Za-zÀ-ÿ]/.test(cleaned)) return null;

  return cleaned;
};

const extractRouteFromText = (
  rawText: string,
): { origin: string | null; destination: string | null } => {
  const text = cleanOcrLine(rawText);
  if (!text) return { origin: null, destination: null };

  const routePatterns = [
    /transportad[ao]\s+de\s+(.+?)\s+para\s+(.+?)(?=\s+(?:dist[âa]ncia|tempo|combust[ií]vel|recompensa|$)|[.!?])/i,
    /(?:entrega|carga|frete).*?\bde\s+(.+?)\s+para\s+(.+?)(?=\s+(?:dist[âa]ncia|tempo|combust[ií]vel|recompensa|$)|[.!?])/i,
    /(?:transported|delivered|hauled)\s+from\s+(.+?)\s+to\s+(.+?)(?=\s+(?:driven\s+distance|distance|time|fuel|reward|$)|[.!?])/i,
    /(?:delivery|cargo|job).*?\bfrom\s+(.+?)\s+to\s+(.+?)(?=\s+(?:driven\s+distance|distance|time|fuel|reward|$)|[.!?])/i,
  ];

  for (const pattern of routePatterns) {
    const match = text.match(pattern);
    if (!match) continue;

    const origin = cleanCityName(match[1] || "");
    const destination = cleanCityName(match[2] || "");

    if (origin && destination) {
      return { origin, destination };
    }
  }

  return { origin: null, destination: null };
};

const parseIntegerLikeGameNumber = (value: string): number | null => {
  const corrected = replaceLikelyDigitConfusions(value);
  const digits = corrected.replace(/\D/g, "");
  if (!digits) return null;

  const parsed = Number(digits);
  if (!Number.isFinite(parsed) || parsed <= 0) return null;

  return parsed;
};

const DISTANCE_NUMBER_TOKEN =
  "[0-9OoQIl|!SsBb]+(?:[.,][0-9OoQIl|!SsBb]+)*";
const DISTANCE_UNIT_TOKEN = "km|kms|kilometers?|kilometres?|mi|miles?";

const extractDistanceFromText = (
  rawText: string,
): { distanceKm: number | null; sourceDistanceUnit: "km" | "mi" | null } => {
  const text = cleanOcrLine(rawText);
  if (!text) return { distanceKm: null, sourceDistanceUnit: null };

  // Important: do not allow arbitrary whitespace inside the numeric token.
  // The previous expression accepted strings such as "4 117 km" and then
  // parseIntegerLikeGameNumber removed the space, silently turning 117 into
  // 4117. A stray glyph generated by OCR must remain a separate token.
  const directPattern = new RegExp(
    `(${DISTANCE_NUMBER_TOKEN})\\s*(${DISTANCE_UNIT_TOKEN})\\b`,
    "i",
  );
  const directMatch = text.match(directPattern);

  // A wider desktop crop may preserve the distance label but lose unrelated
  // surrounding text. The unit remains mandatory: ATS and ETS2 can both be
  // configured with different measurement systems, so the simulator name is
  // not a safe source for deciding whether an OCR number is km or miles.
  const labelledPattern = new RegExp(
    `(?:dist[âa]ncia\\s+(?:percorrida|dirigida)|driven\\s+distance|distance\\s+driven)\\s*[:\\-]?\\s*(${DISTANCE_NUMBER_TOKEN})\\s*(${DISTANCE_UNIT_TOKEN})\\b`,
    "i",
  );
  const labelledMatch = text.match(labelledPattern);

  const match = labelledMatch || directMatch;
  if (!match) return { distanceKm: null, sourceDistanceUnit: null };

  const amount = parseIntegerLikeGameNumber(match[1]);
  if (!amount || amount > 100000) {
    return { distanceKm: null, sourceDistanceUnit: null };
  }

  const unit = match[2].toLowerCase();
  if (unit === "mi" || unit.startsWith("mile")) {
    const converted = Math.round(amount * 1.609344 * 100) / 100;
    return { distanceKm: converted, sourceDistanceUnit: "mi" };
  }

  return { distanceKm: amount, sourceDistanceUnit: "km" };
};

const STRICT_DISTANCE_NUMBER_TOKEN = "[0-9]+(?:[.,][0-9]+)*";

/**
 * Distance autofill uses a deliberately stricter parser than the generic OCR
 * helpers. It accepts only digits that Tesseract actually returned. Letter-to-
 * digit substitutions (I->1, S->5, etc.) are not allowed here because those
 * substitutions can manufacture a number that is not visible in the image.
 */
const extractStrictDistanceFromText = (
  rawText: string,
): { distanceKm: number | null; sourceDistanceUnit: "km" | "mi" | null } => {
  const text = cleanOcrLine(rawText);
  if (!text) return { distanceKm: null, sourceDistanceUnit: null };

  const pattern = new RegExp(
    `(?:^|[^A-Za-z0-9])(${STRICT_DISTANCE_NUMBER_TOKEN})\\s*(${DISTANCE_UNIT_TOKEN})\\b`,
    "i",
  );
  const match = text.match(pattern);
  if (!match) return { distanceKm: null, sourceDistanceUnit: null };

  // Do not silently drop a separate digit immediately before the token.
  // Example: if OCR returns "4 117 km", treating only the trailing "117" as
  // authoritative would also be a guess. The multi-read resolver will use a
  // clean independent read instead, or leave the field empty.
  const matchIndex = match.index ?? 0;
  const prefix = text.slice(0, matchIndex + (match[0].length - match[0].trimStart().length));
  if (/\d\s*$/.test(prefix)) {
    return { distanceKm: null, sourceDistanceUnit: null };
  }

  const rawAmount = match[1];
  const digits = rawAmount.replace(/[.,]/g, "");
  if (!digits || !/^\d+$/.test(digits)) {
    return { distanceKm: null, sourceDistanceUnit: null };
  }

  const amount = Number(digits);
  if (!Number.isFinite(amount) || amount <= 0 || amount > 100000) {
    return { distanceKm: null, sourceDistanceUnit: null };
  }

  const unit = match[2].toLowerCase();
  if (unit === "mi" || unit.startsWith("mile")) {
    return {
      distanceKm: Math.round(amount * 1.609344 * 100) / 100,
      sourceDistanceUnit: "mi",
    };
  }

  return { distanceKm: amount, sourceDistanceUnit: "km" };
};

type StrictDistanceReading = {
  distanceKm: number | null;
  sourceDistanceUnit: "km" | "mi" | null;
};

const strictDistanceKey = (reading: StrictDistanceReading): string | null => {
  if (!reading.distanceKm || !reading.sourceDistanceUnit) return null;
  return `${reading.sourceDistanceUnit}:${reading.distanceKm.toFixed(2)}`;
};

/**
 * Resolve distance only from dedicated distance fields. We run two segmentation
 * modes on the upper row and two on the duplicated reward row. A value is used
 * only when independent reads agree. If OCR disagrees, autofill is skipped
 * instead of guessing or adding/removing digits.
 */
const resolveStrictDistanceReadings = (
  primarySingleText: string,
  primarySparseText: string,
  rewardSingleText: string,
  rewardSparseText: string,
): StrictDistanceReading => {
  const primary = [primarySingleText, primarySparseText]
    .map(extractStrictDistanceFromText)
    .filter((item) => Boolean(strictDistanceKey(item)));
  const reward = [rewardSingleText, rewardSparseText]
    .map(extractStrictDistanceFromText)
    .filter((item) => Boolean(strictDistanceKey(item)));

  const countByKey = (items: StrictDistanceReading[]) => {
    const counts = new Map<string, { count: number; reading: StrictDistanceReading }>();
    for (const item of items) {
      const key = strictDistanceKey(item);
      if (!key) continue;
      const current = counts.get(key);
      counts.set(key, { count: (current?.count || 0) + 1, reading: item });
    }
    return counts;
  };

  const primaryCounts = countByKey(primary);
  const rewardCounts = countByKey(reward);
  const allKeys = new Set([...primaryCounts.keys(), ...rewardCounts.keys()]);

  // When both real distance locations are readable, a candidate must appear in
  // both. Among those candidates, use only a unique best-supported value. If
  // two different numbers have equal support, there is no safe automatic fill.
  if (primary.length > 0 && reward.length > 0) {
    const candidates = [...allKeys]
      .filter((key) => primaryCounts.has(key) && rewardCounts.has(key))
      .map((key) => ({
        key,
        count: (primaryCounts.get(key)?.count || 0) + (rewardCounts.get(key)?.count || 0),
        reading: primaryCounts.get(key)!.reading,
      }))
      .sort((left, right) => right.count - left.count);

    if (candidates.length > 0) {
      const top = candidates[0];
      const tied = candidates.length > 1 && candidates[1].count === top.count;
      if (!tied) return top.reading;
    }
  }

  // If one screen location cannot be read at all, two identical segmentation
  // reads from the other location are required and that location itself must
  // not contain a competing numeric candidate.
  if (reward.length === 0 && primaryCounts.size === 1) {
    const only = [...primaryCounts.values()][0];
    if (only.count >= 2) return only.reading;
  }
  if (primary.length === 0 && rewardCounts.size === 1) {
    const only = [...rewardCounts.values()][0];
    if (only.count >= 2) return only.reading;
  }

  console.warn("[NVU SCS OCR] distance OCR disagreement; autofill skipped", {
    primarySingle: cleanOcrLine(primarySingleText),
    primarySparse: cleanOcrLine(primarySparseText),
    rewardSingle: cleanOcrLine(rewardSingleText),
    rewardSparse: cleanOcrLine(rewardSparseText),
  });
  return { distanceKm: null, sourceDistanceUnit: null };
};

const formatCurrencyInput = (integerAmount: number): string =>
  integerAmount.toLocaleString("pt-BR", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });

const extractValueFromText = (rawText: string): string | null => {
  const text = cleanOcrLine(rawText);
  if (!text) return null;

  const corrected = replaceLikelyDigitConfusions(text);
  // The SCS payout is an integer amount. Read only the first contiguous
  // numeric token so a nearby XP value can never be appended to the earnings.
  const currencyAwareMatch = corrected.match(
    /(?:[$€£]\s*)?([0-9][0-9.,]{0,18})/,
  );

  if (!currencyAwareMatch?.[1]) return null;

  const amount = parseIntegerLikeGameNumber(currencyAwareMatch[1]);
  if (!amount || amount > 1_000_000_000) return null;

  return formatCurrencyInput(amount);
};

const decodeImage = async (file: File): Promise<DecodedImage> => {
  if (typeof createImageBitmap === "function") {
    try {
      const bitmap = await createImageBitmap(file);
      return {
        source: bitmap,
        width: bitmap.width,
        height: bitmap.height,
        cleanup: () => bitmap.close(),
      };
    } catch (error) {
      console.warn("[NVU SCS OCR] createImageBitmap fallback", error);
    }
  }

  const objectUrl = URL.createObjectURL(file);
  const image = new Image();
  image.decoding = "async";
  image.src = objectUrl;

  await new Promise<void>((resolve, reject) => {
    image.onload = () => resolve();
    image.onerror = () => reject(new Error("Não foi possível abrir a imagem."));
  });

  return {
    source: image,
    width: image.naturalWidth,
    height: image.naturalHeight,
    cleanup: () => URL.revokeObjectURL(objectUrl),
  };
};

const resolveReferenceViewport = (
  width: number,
  height: number,
): ReferenceViewport => {
  const aspectRatio = width / Math.max(1, height);

  if (aspectRatio > REFERENCE_ASPECT_RATIO) {
    const viewportWidth = height * REFERENCE_ASPECT_RATIO;
    return {
      x: (width - viewportWidth) / 2,
      y: 0,
      width: viewportWidth,
      height,
    };
  }

  // Do not vertically crop 16:10 / 4:3 desktop screenshots. SCS renders its
  // delivery UI across the real game viewport in those aspect ratios; treating
  // the extra height as letterboxing shifts the route/distance rows downward.
  // This was the reason the same image worked on 16:9 mobile captures but the
  // desktop OCR could read the reward while missing or misreading distance.
  return { x: 0, y: 0, width, height };
};

const percentile = (
  histogram: Uint32Array,
  total: number,
  ratio: number,
): number => {
  const target = Math.max(1, Math.floor(total * ratio));
  let accumulated = 0;

  for (let index = 0; index < histogram.length; index += 1) {
    accumulated += histogram[index];
    if (accumulated >= target) return index;
  }

  return 255;
};

const buildPreparedCrop = (
  decoded: DecodedImage,
  region: CropRegion,
): HTMLCanvasElement => {
  const viewport = resolveReferenceViewport(decoded.width, decoded.height);

  const sourceX = Math.round(viewport.x + viewport.width * region.x);
  const sourceY = Math.round(viewport.y + viewport.height * region.y);
  const sourceWidth = Math.max(1, Math.round(viewport.width * region.width));
  const sourceHeight = Math.max(1, Math.round(viewport.height * region.height));

  const requestedScale = region.targetWidth / sourceWidth;
  const scale = Math.min(
    region.maxScale,
    Math.max(region.minScale, requestedScale),
  );
  const border = 28;
  const targetWidth = Math.round(sourceWidth * scale);
  const targetHeight = Math.round(sourceHeight * scale);

  const canvas = document.createElement("canvas");
  canvas.width = targetWidth + border * 2;
  canvas.height = targetHeight + border * 2;

  const context = canvas.getContext("2d", { willReadFrequently: true });
  if (!context) throw new Error("Canvas OCR indisponível.");

  context.fillStyle = "#ffffff";
  context.fillRect(0, 0, canvas.width, canvas.height);
  context.imageSmoothingEnabled = true;
  context.imageSmoothingQuality = "high";
  context.drawImage(
    decoded.source,
    sourceX,
    sourceY,
    sourceWidth,
    sourceHeight,
    border,
    border,
    targetWidth,
    targetHeight,
  );

  const imageData = context.getImageData(border, border, targetWidth, targetHeight);
  const histogram = new Uint32Array(256);

  for (let index = 0; index < imageData.data.length; index += 4) {
    const red = imageData.data[index];
    const green = imageData.data[index + 1];
    const blue = imageData.data[index + 2];
    const luminance = Math.round(red * 0.299 + green * 0.587 + blue * 0.114);
    histogram[luminance] += 1;
  }

  const totalPixels = targetWidth * targetHeight;
  const brightTextThreshold = Math.min(
    210,
    Math.max(160, percentile(histogram, totalPixels, 0.9)),
  );

  // SCS summary screens use bright text over gray/dark rows. Convert only the
  // bright glyphs to black and everything else to white for a clean OCR line.
  for (let index = 0; index < imageData.data.length; index += 4) {
    const red = imageData.data[index];
    const green = imageData.data[index + 1];
    const blue = imageData.data[index + 2];
    const luminance = Math.round(red * 0.299 + green * 0.587 + blue * 0.114);
    const output = luminance >= brightTextThreshold ? 0 : 255;

    imageData.data[index] = output;
    imageData.data[index + 1] = output;
    imageData.data[index + 2] = output;
    imageData.data[index + 3] = 255;
  }

  context.putImageData(imageData, border, border);
  return canvas;
};

const ocrLogger = (message: { status: string; progress?: number }) => {
  if (message.status === "recognizing text") {
    console.log(
      "[NVU SCS OCR] progress",
      Math.round((message.progress || 0) * 100),
    );
  }
};

const createLocalWorker = async () => {
  const tesseractModule: any = await import("tesseract.js");
  const Tesseract: any = tesseractModule.default || tesseractModule;
  const createWorker = Tesseract.createWorker || tesseractModule.createWorker;

  if (typeof createWorker !== "function") {
    throw new Error("Worker OCR indisponível.");
  }

  try {
    return await createWorker("eng", 1, {
      langPath: LOCAL_TESSDATA_PATH,
      logger: ocrLogger,
    });
  } catch (localModelError) {
    // Compatibility fallback only. Normal deployments use the bundled model,
    // keeping OCR local and without a paid OCR API.
    console.warn("[NVU SCS OCR] local model fallback", localModelError);
    return createWorker("eng", 1, { logger: ocrLogger });
  }
};

const recognizeSingleLine = async (
  worker: any,
  image: HTMLCanvasElement,
  whitelist = "",
): Promise<string> => {
  const tesseractModule: any = await import("tesseract.js");
  const Tesseract: any = tesseractModule.default || tesseractModule;
  const PSM = Tesseract.PSM || tesseractModule.PSM || {};

  await worker.setParameters({
    tessedit_pageseg_mode: PSM.SINGLE_LINE ?? "7",
    tessedit_char_whitelist: whitelist,
    preserve_interword_spaces: "1",
    user_defined_dpi: "300",
  });

  const result = await worker.recognize(image);
  return result?.data?.text || "";
};

const recognizeSparseDistance = async (
  worker: any,
  image: HTMLCanvasElement,
): Promise<string> => {
  const tesseractModule: any = await import("tesseract.js");
  const Tesseract: any = tesseractModule.default || tesseractModule;
  const PSM = Tesseract.PSM || tesseractModule.PSM || {};

  await worker.setParameters({
    tessedit_pageseg_mode: PSM.SPARSE_TEXT ?? "11",
    // Do not offer letter aliases for the numeric part. If a digit cannot be
    // recognized as a digit, that read must not be used for automatic fill.
    tessedit_char_whitelist: "0123456789., kmKMilesILES",
    preserve_interword_spaces: "1",
    user_defined_dpi: "300",
  });

  const result = await worker.recognize(image);
  return result?.data?.text || "";
};

const recognizeTextBlock = async (
  worker: any,
  image: HTMLCanvasElement,
): Promise<string> => {
  const tesseractModule: any = await import("tesseract.js");
  const Tesseract: any = tesseractModule.default || tesseractModule;
  const PSM = Tesseract.PSM || tesseractModule.PSM || {};

  await worker.setParameters({
    tessedit_pageseg_mode: PSM.SPARSE_TEXT ?? PSM.AUTO ?? "11",
    tessedit_char_whitelist: "",
    preserve_interword_spaces: "1",
    user_defined_dpi: "300",
  });

  const result = await worker.recognize(image);
  return result?.data?.text || "";
};

export async function extractScsTripData(
  file: File,
  simulatorCode: string,
): Promise<ScsTripOcrResult | null> {
  if (simulatorCode !== "ATS" && simulatorCode !== "ETS2") {
    return null;
  }

  let decoded: DecodedImage | null = null;
  let worker: any = null;

  try {
    console.log("[NVU SCS OCR] start", simulatorCode, file.name, file.size);
    decoded = await decodeImage(file);

    if (decoded.width < 640 || decoded.height < 360) {
      console.warn("[NVU SCS OCR] image too small", decoded.width, decoded.height);
      return null;
    }

    const routeCanvas = buildPreparedCrop(decoded, ROUTE_CROP);
    const distanceCanvas = buildPreparedCrop(decoded, DISTANCE_CROP);
    const rewardDistanceCanvas = buildPreparedCrop(decoded, DISTANCE_REWARD_CROP);
    const valueCanvas = buildPreparedCrop(decoded, VALUE_CROP);

    worker = await createLocalWorker();

    const routeText = await recognizeSingleLine(worker, routeCanvas);
    const distanceText = await recognizeSingleLine(
      worker,
      distanceCanvas,
      "0123456789., kmKMilesILES",
    );
    const distanceSparseText = await recognizeSparseDistance(worker, distanceCanvas);
    const distanceRewardText = await recognizeSingleLine(
      worker,
      rewardDistanceCanvas,
      "0123456789., kmKMilesILES",
    );
    const distanceRewardSparseText = await recognizeSparseDistance(
      worker,
      rewardDistanceCanvas,
    );
    const valueText = await recognizeSingleLine(
      worker,
      valueCanvas,
      "0123456789OoQIl|!SsBb.,$€£ ",
    );

    let route = extractRouteFromText(routeText);
    // Distance autofill is intentionally strict. Broad text blocks are never
    // allowed to supply a number because they can hallucinate a leading glyph
    // (the reported 117 -> 4117 failure).
    const distance = resolveStrictDistanceReadings(
      distanceText,
      distanceSparseText,
      distanceRewardText,
      distanceRewardSparseText,
    );
    const value = extractValueFromText(valueText);
    let desktopRouteText = "";
    let summaryFallbackText = "";

    // Preserve the route fallback for desktop UI scaling. Distance is never
    // recovered from this broad block because broad OCR is exactly where stray
    // leading digits can be introduced.
    if (!route.origin || !route.destination) {
      const summaryCanvas = buildPreparedCrop(decoded, SUMMARY_FALLBACK_CROP);
      summaryFallbackText = await recognizeTextBlock(worker, summaryCanvas);

      if (!route.origin || !route.destination) {
        const summaryRoute = extractRouteFromText(summaryFallbackText);
        if (summaryRoute.origin && summaryRoute.destination) route = summaryRoute;
      }
    }

    // Route may use broad fallbacks because it is text. Distance may not: if
    // the dedicated upper/reward rows do not agree, the field remains empty so
    // the app never invents or silently modifies a trip number.
    if (!route.origin || !route.destination) {
      const desktopRouteCanvas = buildPreparedCrop(decoded, ROUTE_DESKTOP_CROP);
      desktopRouteText = await recognizeTextBlock(worker, desktopRouteCanvas);
      const desktopRoute = extractRouteFromText(desktopRouteText);
      if (desktopRoute.origin && desktopRoute.destination) route = desktopRoute;
    }

    console.log("[NVU SCS OCR] text", {
      simulatorCode,
      route: cleanOcrLine(routeText),
      distanceSingle: cleanOcrLine(distanceText),
      distanceSparse: cleanOcrLine(distanceSparseText),
      rewardDistanceSingle: cleanOcrLine(distanceRewardText),
      rewardDistanceSparse: cleanOcrLine(distanceRewardSparseText),
      value: cleanOcrLine(valueText),
      desktopRoute: cleanOcrLine(desktopRouteText),
      summaryFallback: cleanOcrLine(summaryFallbackText),
    });
    console.log("[NVU SCS OCR] result", {
      ...route,
      ...distance,
      value,
    });

    return {
      origin: route.origin,
      destination: route.destination,
      distanceKm: distance.distanceKm,
      sourceDistanceUnit: distance.sourceDistanceUnit,
      value,
    };
  } catch (error) {
    console.error("[NVU SCS OCR] error", error);
    return null;
  } finally {
    decoded?.cleanup();
    if (worker) {
      try {
        await worker.terminate();
      } catch (terminateError) {
        console.warn("[NVU SCS OCR] worker terminate", terminateError);
      }
    }
  }
}

export const __scsOcrTestUtils = {
  extractRouteFromText,
  extractDistanceFromText,
  extractStrictDistanceFromText,
  resolveStrictDistanceReadings,
  extractValueFromText,
  replaceLikelyDigitConfusions,
};
