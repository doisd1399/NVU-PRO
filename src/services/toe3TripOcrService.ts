const LOCAL_TESSDATA_PATH = "/tessdata";
const REFERENCE_ASPECT_RATIO = 20 / 9;

export interface Toe3TripOcrResult {
  distanceKm: number | null;
  value: string | null;
}

interface DecodedImage {
  source: CanvasImageSource;
  width: number;
  height: number;
  cleanup: () => void;
}

interface ReferenceViewport {
  x: number;
  y: number;
  width: number;
  height: number;
}

interface NormalizedRegion {
  x: number;
  y: number;
  width: number;
  height: number;
}

interface SourceRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

// TOE 3 uses a stable mobile delivery-summary screen. Instead of OCRing the
// entire screenshot, search only the rows that contain "Distância acionada"
// and "Renda total". The bright value cell is detected inside each band, which
// keeps the implementation tolerant to small UI shifts and different captures.
const DISTANCE_SEARCH: NormalizedRegion = {
  x: 0.4,
  y: 0.49,
  width: 0.16,
  height: 0.075,
};

const VALUE_SEARCH: NormalizedRegion = {
  x: 0.56,
  y: 0.595,
  width: 0.16,
  height: 0.085,
};

// Conservative fallbacks for the standard 20:9 TOE 3 result layout. They are
// used only if the bright cell cannot be located automatically.
const DISTANCE_FALLBACK: NormalizedRegion = {
  x: 0.454,
  y: 0.51,
  width: 0.037,
  height: 0.043,
};

const VALUE_FALLBACK: NormalizedRegion = {
  x: 0.618,
  y: 0.613,
  width: 0.051,
  height: 0.049,
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
      console.warn("[NVU TOE3 OCR] createImageBitmap fallback", error);
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

  if (aspectRatio < REFERENCE_ASPECT_RATIO) {
    const viewportHeight = width / REFERENCE_ASPECT_RATIO;
    return {
      x: 0,
      y: (height - viewportHeight) / 2,
      width,
      height: viewportHeight,
    };
  }

  return { x: 0, y: 0, width, height };
};

const normalizedRegionToSourceRect = (
  viewport: ReferenceViewport,
  region: NormalizedRegion,
): SourceRect => ({
  x: Math.round(viewport.x + viewport.width * region.x),
  y: Math.round(viewport.y + viewport.height * region.y),
  width: Math.max(1, Math.round(viewport.width * region.width)),
  height: Math.max(1, Math.round(viewport.height * region.height)),
});

const clampRect = (
  rect: SourceRect,
  width: number,
  height: number,
): SourceRect => {
  const x = Math.max(0, Math.min(width - 1, Math.round(rect.x)));
  const y = Math.max(0, Math.min(height - 1, Math.round(rect.y)));
  const right = Math.max(x + 1, Math.min(width, Math.round(rect.x + rect.width)));
  const bottom = Math.max(y + 1, Math.min(height, Math.round(rect.y + rect.height)));

  return { x, y, width: right - x, height: bottom - y };
};

/**
 * Finds the large light trapezoid/rectangle used by TOE 3 to display a value.
 * The search area is intentionally small, so a compact flood fill is cheaper
 * than OCRing labels and avoids depending on the game language.
 */
const detectBrightValueCell = (
  decoded: DecodedImage,
  searchRect: SourceRect,
): SourceRect | null => {
  const canvas = document.createElement("canvas");
  canvas.width = searchRect.width;
  canvas.height = searchRect.height;

  const context = canvas.getContext("2d", { willReadFrequently: true });
  if (!context) return null;

  context.drawImage(
    decoded.source,
    searchRect.x,
    searchRect.y,
    searchRect.width,
    searchRect.height,
    0,
    0,
    searchRect.width,
    searchRect.height,
  );

  const imageData = context.getImageData(0, 0, canvas.width, canvas.height);
  const pixelCount = canvas.width * canvas.height;
  const bright = new Uint8Array(pixelCount);
  const visited = new Uint8Array(pixelCount);

  for (let index = 0; index < pixelCount; index += 1) {
    const offset = index * 4;
    const red = imageData.data[offset];
    const green = imageData.data[offset + 1];
    const blue = imageData.data[offset + 2];
    const maxChannel = Math.max(red, green, blue);
    const minChannel = Math.min(red, green, blue);
    const luminance = red * 0.299 + green * 0.587 + blue * 0.114;

    if (luminance >= 172 && maxChannel - minChannel <= 58) {
      bright[index] = 1;
    }
  }

  let best:
    | { count: number; minX: number; minY: number; maxX: number; maxY: number }
    | null = null;
  const stack: number[] = [];

  for (let start = 0; start < pixelCount; start += 1) {
    if (!bright[start] || visited[start]) continue;

    visited[start] = 1;
    stack.push(start);
    let count = 0;
    let minX = canvas.width;
    let minY = canvas.height;
    let maxX = 0;
    let maxY = 0;

    while (stack.length > 0) {
      const current = stack.pop() as number;
      const x = current % canvas.width;
      const y = Math.floor(current / canvas.width);
      count += 1;
      minX = Math.min(minX, x);
      minY = Math.min(minY, y);
      maxX = Math.max(maxX, x);
      maxY = Math.max(maxY, y);

      if (x > 0) {
        const left = current - 1;
        if (bright[left] && !visited[left]) {
          visited[left] = 1;
          stack.push(left);
        }
      }
      if (x + 1 < canvas.width) {
        const right = current + 1;
        if (bright[right] && !visited[right]) {
          visited[right] = 1;
          stack.push(right);
        }
      }
      if (y > 0) {
        const up = current - canvas.width;
        if (bright[up] && !visited[up]) {
          visited[up] = 1;
          stack.push(up);
        }
      }
      if (y + 1 < canvas.height) {
        const down = current + canvas.width;
        if (bright[down] && !visited[down]) {
          visited[down] = 1;
          stack.push(down);
        }
      }
    }

    const componentWidth = maxX - minX + 1;
    const componentHeight = maxY - minY + 1;
    const aspect = componentWidth / Math.max(1, componentHeight);
    const minimumArea = Math.max(80, pixelCount * 0.025);

    if (
      count < minimumArea ||
      componentWidth < canvas.width * 0.28 ||
      componentHeight < canvas.height * 0.2 ||
      aspect < 2
    ) {
      continue;
    }

    if (!best || count > best.count) {
      best = { count, minX, minY, maxX, maxY };
    }
  }

  if (!best) return null;

  return {
    x: searchRect.x + best.minX,
    y: searchRect.y + best.minY,
    width: best.maxX - best.minX + 1,
    height: best.maxY - best.minY + 1,
  };
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

const buildPreparedDigitsCrop = (
  decoded: DecodedImage,
  sourceRect: SourceRect,
  options: { leftFraction?: number; rightFraction?: number; verticalMargin?: number },
): HTMLCanvasElement => {
  const leftFraction = options.leftFraction ?? 0;
  const rightFraction = options.rightFraction ?? 1;
  const verticalMargin = Math.max(0, options.verticalMargin ?? 0);

  const adjusted = clampRect(
    {
      x: sourceRect.x + sourceRect.width * leftFraction,
      y: sourceRect.y - verticalMargin,
      width: sourceRect.width * Math.max(0.1, rightFraction - leftFraction),
      height: sourceRect.height + verticalMargin * 2,
    },
    decoded.width,
    decoded.height,
  );

  const requestedScale = 900 / adjusted.width;
  const scale = Math.min(10, Math.max(5, requestedScale));
  const border = 24;
  const targetWidth = Math.max(1, Math.round(adjusted.width * scale));
  const targetHeight = Math.max(1, Math.round(adjusted.height * scale));

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
    adjusted.x,
    adjusted.y,
    adjusted.width,
    adjusted.height,
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
  const low = percentile(histogram, totalPixels, 0.04);
  const high = percentile(histogram, totalPixels, 0.96);
  const span = Math.max(40, high - low);

  // Grayscale + contrast stretch preserves the stylized TOE 3 digits better
  // than hard binarization (notably 3/8/6) while removing most panel colors.
  for (let index = 0; index < imageData.data.length; index += 4) {
    const red = imageData.data[index];
    const green = imageData.data[index + 1];
    const blue = imageData.data[index + 2];
    const luminance = red * 0.299 + green * 0.587 + blue * 0.114;
    const stretched = Math.max(0, Math.min(255, ((luminance - low) * 255) / span));

    imageData.data[index] = stretched;
    imageData.data[index + 1] = stretched;
    imageData.data[index + 2] = stretched;
    imageData.data[index + 3] = 255;
  }

  context.putImageData(imageData, border, border);
  return canvas;
};

const ocrLogger = (message: { status: string; progress?: number }) => {
  if (message.status === "recognizing text") {
    console.log(
      "[NVU TOE3 OCR] progress",
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
    // Compatibility fallback only. Normal deployments use /public/tessdata,
    // so TOE 3 OCR remains local and does not require a paid OCR API.
    console.warn("[NVU TOE3 OCR] local model fallback", localModelError);
    return createWorker("eng", 1, { logger: ocrLogger });
  }
};

const recognizeDigits = async (
  worker: any,
  image: HTMLCanvasElement,
): Promise<string> => {
  const tesseractModule: any = await import("tesseract.js");
  const Tesseract: any = tesseractModule.default || tesseractModule;
  const PSM = Tesseract.PSM || tesseractModule.PSM || {};

  await worker.setParameters({
    tessedit_pageseg_mode: PSM.SINGLE_LINE ?? "7",
    tessedit_char_whitelist: "0123456789 ",
    preserve_interword_spaces: "1",
    user_defined_dpi: "300",
  });

  const result = await worker.recognize(image);
  return result?.data?.text || "";
};

const parsePositiveInteger = (
  rawText: string,
  maximum: number,
): number | null => {
  const digits = rawText.replace(/\D/g, "");
  if (!digits) return null;

  const parsed = Number(digits);
  if (!Number.isFinite(parsed) || parsed <= 0 || parsed > maximum) return null;
  return parsed;
};

const formatCurrencyInput = (integerAmount: number): string =>
  integerAmount.toLocaleString("pt-BR", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });

export async function extractToe3TripData(
  file: File,
): Promise<Toe3TripOcrResult | null> {
  let decoded: DecodedImage | null = null;
  let worker: any = null;

  try {
    console.log("[NVU TOE3 OCR] start", file.name, file.size);
    decoded = await decodeImage(file);

    if (decoded.width < 640 || decoded.height < 320) {
      console.warn("[NVU TOE3 OCR] image too small", decoded.width, decoded.height);
      return null;
    }

    const viewport = resolveReferenceViewport(decoded.width, decoded.height);
    const distanceSearchRect = clampRect(
      normalizedRegionToSourceRect(viewport, DISTANCE_SEARCH),
      decoded.width,
      decoded.height,
    );
    const valueSearchRect = clampRect(
      normalizedRegionToSourceRect(viewport, VALUE_SEARCH),
      decoded.width,
      decoded.height,
    );

    const detectedDistanceCell = detectBrightValueCell(decoded, distanceSearchRect);
    const detectedValueCell = detectBrightValueCell(decoded, valueSearchRect);

    const distanceRect =
      detectedDistanceCell ||
      clampRect(
        normalizedRegionToSourceRect(viewport, DISTANCE_FALLBACK),
        decoded.width,
        decoded.height,
      );
    const valueRect =
      detectedValueCell ||
      clampRect(
        normalizedRegionToSourceRect(viewport, VALUE_FALLBACK),
        decoded.width,
        decoded.height,
      );

    // The distance cell ends with "Km". Keep the left/middle area where the
    // numeric token lives so the stylized K/m cannot be mistaken for digits.
    const distanceCanvas = buildPreparedDigitsCrop(decoded, distanceRect, {
      leftFraction: detectedDistanceCell ? 0.18 : 0,
      rightFraction: detectedDistanceCell ? 0.69 : 1,
      verticalMargin: Math.max(3, Math.round(distanceRect.height * 0.2)),
    });

    // Drop the leading € sign from the total-income cell. NVU stores the game
    // amount as the trip value; no currency conversion is performed.
    const valueCanvas = buildPreparedDigitsCrop(decoded, valueRect, {
      leftFraction: detectedValueCell ? 0.18 : 0,
      rightFraction: detectedValueCell ? 0.96 : 1,
      verticalMargin: Math.max(3, Math.round(valueRect.height * 0.18)),
    });

    worker = await createLocalWorker();
    const distanceText = await recognizeDigits(worker, distanceCanvas);
    const valueText = await recognizeDigits(worker, valueCanvas);

    const distanceKm = parsePositiveInteger(distanceText, 100_000);
    const valueAmount = parsePositiveInteger(valueText, 1_000_000_000);
    const value = valueAmount ? formatCurrencyInput(valueAmount) : null;

    console.log("[NVU TOE3 OCR] text", {
      distance: distanceText.replace(/\s+/g, " ").trim(),
      value: valueText.replace(/\s+/g, " ").trim(),
      distanceCellDetected: Boolean(detectedDistanceCell),
      valueCellDetected: Boolean(detectedValueCell),
    });
    console.log("[NVU TOE3 OCR] result", { distanceKm, value });

    if (!distanceKm && !value) return null;
    return { distanceKm, value };
  } catch (error) {
    console.error("[NVU TOE3 OCR] error", error);
    return null;
  } finally {
    decoded?.cleanup();
    if (worker) {
      try {
        await worker.terminate();
      } catch (terminateError) {
        console.warn("[NVU TOE3 OCR] worker terminate", terminateError);
      }
    }
  }
}

export const __toe3OcrTestUtils = {
  parsePositiveInteger,
  formatCurrencyInput,
};
