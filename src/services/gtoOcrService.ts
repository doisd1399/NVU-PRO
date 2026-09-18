import { withTimeout } from "../lib/asyncTimeout";

const LOCAL_TESSDATA_PATH = "/tessdata";
const LOCAL_TESSERACT_WORKER_PATH = "/tesseract/worker.min.js";
const LOCAL_TESSERACT_CORE_PATH = "/tesseract/core";
const VALUE_CROP = {
  x: 0.28,
  y: 0.35,
  width: 0.44,
  height: 0.23,
};

// Android users often upload the complete portrait screen instead of a crop of
// the landscape GTO modal. In that layout the received amount sits in the
// lower half of the image preview, so the old centered crop never reached it.
const PORTRAIT_VALUE_CROP = {
  x: 0.08,
  y: 0.28,
  width: 0.84,
  height: 0.56,
};

const RESULT_ANALYSIS_CROP = {
  x: 0.12,
  y: 0.10,
  width: 0.76,
  height: 0.80,
};

export interface GtoReceiptAnalysis {
  value: string | null;
  doubledByAd: boolean;
  evidence: string[];
  analysisOk: boolean;
  rawText: string;
}

export interface GtoReceiptAnalysisOptions {
  onValueDetected?: (value: string) => void;
}

interface DecodedImage {
  source: CanvasImageSource;
  width: number;
  height: number;
  cleanup: () => void;
}

const MONEY_TOKEN_PATTERN =
  /[0-9OoQIl|!SsBb][0-9OoQIl|!SsBb.,\s]{1,32}[0-9OoQIl|!SsBb]/g;

const replaceLikelyDigitConfusions = (value: string): string =>
  value
    .replace(/[OoQ]/g, "0")
    .replace(/[Il|!]/g, "1")
    .replace(/[Ss]/g, "5")
    .replace(/[Bb]/g, "8");

const formatDigitsAsBrl = (digits: string): string | null => {
      const normalizedDigits = digits.replace(/\D/g, "");

  if (normalizedDigits.length < 3) return null;

  const cents = normalizedDigits.slice(-2);
  const integerDigits = normalizedDigits.slice(0, -2).replace(/^0+(?=\d)/, "");
  if (!integerDigits) return null;

  const integerPart = Number(integerDigits);
  if (!Number.isFinite(integerPart) || integerPart <= 0) return null;

  return `${integerPart.toLocaleString("pt-BR")},${cents}`;
};

const normalizeMonetaryCandidate = (
  candidate: string,
  allowImplicitCents = false,
): string | null => {
  const corrected = replaceLikelyDigitConfusions(candidate)
    .replace(/\s+/g, "")
    .replace(/[^0-9.,]/g, "");

  if (!corrected) return null;

  const lastComma = corrected.lastIndexOf(",");
  const lastDot = corrected.lastIndexOf(".");
  const decimalSeparatorIndex = Math.max(lastComma, lastDot);

  if (decimalSeparatorIndex < 0) {
    return allowImplicitCents ? formatDigitsAsBrl(corrected) : null;
  }

  const decimalDigits = corrected
    .slice(decimalSeparatorIndex + 1)
    .replace(/\D/g, "");

  if (decimalDigits.length !== 2) return null;

  return formatDigitsAsBrl(corrected);
};

type ValueExtractionOptions = {
  allowImplicitCentsInGeneric?: boolean;
};

const extractValueFromText = (
  rawText: string,
  options: ValueExtractionOptions = {},
): string | null => {
  const text = rawText.replace(/\s+/g, " ").trim();
  if (!text) return null;

  const contextualMatch = text.match(
    /(?:valor\s*(?:a\s*)?receber|receber)(.{0,100})/i,
  );

  if (contextualMatch?.[1]) {
    const amountContext = contextualMatch[1].replace(
      /^\s*[:=\-]?\s*(?:r\s*[$s5]?|rs)?\s*/i,
      "",
    );
    const contextualCandidates = amountContext.match(MONEY_TOKEN_PATTERN);

    for (const candidate of contextualCandidates || []) {
      const normalized = normalizeMonetaryCandidate(candidate, true);
      if (normalized) return normalized;
    }
  }

  const targetedPatterns = [
    /(?:valor\s*(?:a\s*)?receber|receber)[^0-9]{0,40}([0-9][0-9OoQIl|!SsBb\s.,]{2,}[0-9OoQIl|!SsBb])/i,
    /(?:r\s*[$s5]|rs)[^0-9]{0,12}([0-9][0-9OoQIl|!SsBb\s.,]{2,}[0-9OoQIl|!SsBb])/i,
  ];

  for (const pattern of targetedPatterns) {
    const match = text.match(pattern);
    const normalized = match?.[1]
      ? normalizeMonetaryCandidate(match[1], true)
      : null;
    if (normalized) return normalized;
  }

  const genericCandidates = text.match(MONEY_TOKEN_PATTERN);

  if (!genericCandidates) return null;

  for (const candidate of genericCandidates) {
          const normalized = normalizeMonetaryCandidate(
        candidate,
        Boolean(options.allowImplicitCentsInGeneric),
      );

    if (normalized) return normalized;
  }

  return null;
};


const normalizeEvidenceText = (rawText: string): string =>
  rawText
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();

const detectDoubledByAdEvidence = (
  rawText: string,
): { detected: boolean; evidence: string[] } => {
  const normalized = normalizeEvidenceText(rawText);
  if (!normalized) return { detected: false, evidence: [] };

  const evidence: string[] = [];
  const pushEvidence = (label: string) => {
    if (!evidence.includes(label)) evidence.push(label);
  };

  // Strong confirmation phrases. Intentionally do not treat the normal
  // "Dobrar valor / ADS" button as proof that the driver watched an ad.
  if (/\bvalor (?:foi |ja )?dobrad[oa]\b/.test(normalized)) {
    pushEvidence("valor-dobrado");
  }
  if (/\bganh(?:o|os) (?:foi |foram |ja )?dobrad[oa]s?\b/.test(normalized)) {
    pushEvidence("ganho-dobrado");
  }
  if (/\b(?:anuncio|video)\b.{0,45}\b(?:assistid|concluid|finalizad)[oa]s?\b/.test(normalized)
      || /\b(?:assistid|concluid|finalizad)[oa]s?\b.{0,45}\b(?:anuncio|video)\b/.test(normalized)) {
    pushEvidence("midia-assistida");
  }
  if (/\b(?:bonus|recompensa)\b.{0,45}\b(?:recebid|aplicad|concedid|creditad)[oa]s?\b/.test(normalized)
      || /\b(?:recebid|aplicad|concedid|creditad)[oa]s?\b.{0,45}\b(?:bonus|recompensa)\b/.test(normalized)) {
    pushEvidence("recompensa-recebida");
  }

  const doubledMarker =
    /\bdobrad[oa]s?\b/.test(normalized)
    || /\b(?:2x|x2|valor x ?2)\b/.test(normalized);
  const completedAdMarker =
    /\b(?:anuncio|video)\b.{0,45}\b(?:assistid|concluid|finalizad)[oa]s?\b/.test(normalized)
    || /\b(?:assistid|concluid|finalizad)[oa]s?\b.{0,45}\b(?:anuncio|video)\b/.test(normalized)
    || /\b(?:bonus|recompensa)\b.{0,45}\b(?:recebid|aplicad|concedid|creditad)[oa]s?\b/.test(normalized);

  if (doubledMarker && completedAdMarker) {
    pushEvidence("dobro-confirmado-com-anuncio");
  }

  return {
    detected: evidence.length > 0,
    evidence,
  };
};

const detectResultScreenEvidence = (
  rawText: string,
  value: string | null,
): { valid: boolean; evidence: string[] } => {
  const normalized = normalizeEvidenceText(rawText);
  if (!normalized) return { valid: false, evidence: [] };

  const evidence: string[] = [];
  const push = (label: string) => {
    if (!evidence.includes(label)) evidence.push(label);
  };

  if (/\b(?:concluido|concluida|finalizado|finalizada)\b/.test(normalized)) {
    push("tela-conclusao");
  }
  if (/\bvalor.{0,18}(?:a )?receber\b/.test(normalized) || /\breceber\b/.test(normalized)) {
    push("contexto-recebimento");
  }
  if (/\bdobrar valor\b/.test(normalized) || /\bads?\b/.test(normalized)) {
    push("acao-resultado");
  }
  if (value) push("valor-monetario");

  // Require multiple independent clues. This rejects random HUD text while
  // remaining tolerant when OCR misses one field on slower/blurrier devices.
  return {
    valid: evidence.length >= 2,
    evidence,
  };
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
      console.warn("[NVU GTO OCR] createImageBitmap fallback", error);
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

const percentile = (histogram: Uint32Array, total: number, ratio: number): number => {
  const target = Math.max(1, Math.floor(total * ratio));
  let accumulated = 0;

  for (let index = 0; index < histogram.length; index += 1) {
    accumulated += histogram[index];
    if (accumulated >= target) return index;
  }

  return 255;
};

/**
 * GTO uses a fixed landscape result modal. Cropping the center of the image
 * removes the game HUD and makes the value line large enough for local OCR.
 */
const buildValueBandCanvas = async (
  file: File,
  crop = VALUE_CROP,
): Promise<HTMLCanvasElement> => {
  const decoded = await decodeImage(file);

  try {
    const sourceX = Math.round(decoded.width * crop.x);
    const sourceY = Math.round(decoded.height * crop.y);
    const sourceWidth = Math.max(1, Math.round(decoded.width * crop.width));
    const sourceHeight = Math.max(1, Math.round(decoded.height * crop.height));

    const scale = Math.min(4, Math.max(2, 1800 / sourceWidth));
    const border = 32;
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
      205,
      Math.max(135, percentile(histogram, totalPixels, 0.84)),
    );

    // White text becomes black and the dark modal becomes a clean white page.
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
  } finally {
    decoded.cleanup();
  }
};


const buildResultAnalysisCanvas = async (file: File): Promise<HTMLCanvasElement> => {
  const decoded = await decodeImage(file);

  try {
    const sourceX = Math.round(decoded.width * RESULT_ANALYSIS_CROP.x);
    const sourceY = Math.round(decoded.height * RESULT_ANALYSIS_CROP.y);
    const sourceWidth = Math.max(1, Math.round(decoded.width * RESULT_ANALYSIS_CROP.width));
    const sourceHeight = Math.max(1, Math.round(decoded.height * RESULT_ANALYSIS_CROP.height));

    // Keep the analysis reasonably small for low-end devices. The result
    // dialog text is large enough that ~1500 px width remains OCR-friendly.
    const scale = Math.min(2.4, Math.max(1, 1500 / sourceWidth));
    const border = 24;
    const targetWidth = Math.max(1, Math.round(sourceWidth * scale));
    const targetHeight = Math.max(1, Math.round(sourceHeight * scale));

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
    const threshold = Math.min(
      210,
      Math.max(125, percentile(histogram, totalPixels, 0.80)),
    );

    for (let index = 0; index < imageData.data.length; index += 4) {
      const red = imageData.data[index];
      const green = imageData.data[index + 1];
      const blue = imageData.data[index + 2];
      const luminance = Math.round(red * 0.299 + green * 0.587 + blue * 0.114);
      const output = luminance >= threshold ? 0 : 255;

      imageData.data[index] = output;
      imageData.data[index + 1] = output;
      imageData.data[index + 2] = output;
      imageData.data[index + 3] = 255;
    }

    context.putImageData(imageData, border, border);
    return canvas;
  } finally {
    decoded.cleanup();
  }
};

const ocrLogger = (message: { status: string; progress?: number }) => {
  if (message.status === "recognizing text") {
    console.log(
      "[NVU GTO OCR] progress",
      Math.round((message.progress || 0) * 100),
    );
  }
};

type GtoOcrWorker = {
  recognize: (image: HTMLCanvasElement) => Promise<{ data?: { text?: string } }>;
  setParameters?: (params: Record<string, string>) => Promise<unknown>;
  terminate: () => Promise<unknown>;
};

const configureWorker = async (
  worker: GtoOcrWorker,
  params: Record<string, string>,
): Promise<void> => {
  if (typeof worker.setParameters !== "function") return;
  try {
    await worker.setParameters(params);
  } catch (error) {
    // A worker version without this optional API must still perform its
    // default OCR pass instead of turning a readable print into a hard error.
    console.warn("[NVU GTO OCR] optional worker configuration unavailable", error);
  }
};

const createLocalWorker = async (): Promise<GtoOcrWorker> => {
  const tesseractModule: any = await withTimeout(
    import("tesseract.js"),
    8_000,
    "O mecanismo de leitura demorou para iniciar.",
  );
  const api = tesseractModule.default || tesseractModule;
  const createWorker = tesseractModule.createWorker || api.createWorker;
  if (typeof createWorker !== "function") {
    throw new Error("Mecanismo OCR local indisponível.");
  }

  // The language model is bundled in public/tessdata so GTO print mode never
  // depends on a CDN or mobile network just to analyze a receipt.
  return await withTimeout(
    createWorker("eng", undefined, {
      workerPath: LOCAL_TESSERACT_WORKER_PATH,
      corePath: LOCAL_TESSERACT_CORE_PATH,
      langPath: LOCAL_TESSDATA_PATH,
      // Android/aapt2 exposes the packaged asset as eng.traineddata rather
      // than eng.traineddata.gz. Use the same uncompressed contract in Chrome
      // and WebView so the worker requests one identical local path.
      gzip: false,
      logger: ocrLogger,
    }),
    15_000,
    "O modelo OCR local demorou para carregar.",
  );
};

const recognizeWithWorker = async (
  worker: GtoOcrWorker,
  image: HTMLCanvasElement,
  timeoutMs: number,
): Promise<string> => {
  const result = await withTimeout(
    worker.recognize(image),
    timeoutMs,
    "A leitura do comprovante excedeu o tempo seguro neste aparelho.",
  );
  return result?.data?.text || "";
};

const recognizeValueBand = async (
  worker: GtoOcrWorker,
  image: HTMLCanvasElement,
): Promise<string> => {
  const tesseractModule: any = await import("tesseract.js");
  const api = tesseractModule.default || tesseractModule;
  const PSM = api.PSM || tesseractModule.PSM || {};

  await configureWorker(worker, {
    tessedit_pageseg_mode: PSM.SPARSE_TEXT ?? "11",
    // The value path is numeric by design. Restricting the alphabet prevents
    // HUD letters from being promoted as a monetary amount.
    // Keep the amount numeric-first, but retain the Portuguese label letters
    // because Android screenshots frequently OCR `Valor a receber` as context
    // instead of returning only the number. The parser still accepts a value
    // only when it passes the monetary and contextual rules below.
    tessedit_char_whitelist: "0123456789.,R$VvAaLlOoRrEeCcBbTtNnGgUuIisS ",
    preserve_interword_spaces: "1",
    user_defined_dpi: "300",
  });

  return recognizeWithWorker(worker, image, 12_000);
};

export async function analyzeGtoTripReceipt(
  file: File,
  options: GtoReceiptAnalysisOptions = {},
): Promise<GtoReceiptAnalysis> {
  let worker: GtoOcrWorker | null = null;

  try {
    console.log("[NVU GTO OCR] receipt analysis start", file.name, file.size);
    worker = await createLocalWorker();

    let value: string | null = null;
    let valueSource: "numeric-crop" | "broad-diagnostic" | null = null;
    let combinedText = "";
    const promoteValue = (
      candidate: string | null,
      source: "numeric-crop" | "broad-diagnostic",
    ): void => {
      if (!candidate) return;
      // The dedicated numeric crop is authoritative. Broad OCR is contextual
      // evidence and may only be used as a fallback when every numeric crop
      // failed; it must never replace a different crop value.
      if (value && value !== candidate) {
        console.warn("[NVU GTO OCR] conflicting value ignored", {
          current: value,
          currentSource: valueSource,
          candidate,
          candidateSource: source,
        });
        return;
      }
      if (value === candidate && valueSource === source) return;
      value = candidate;
      valueSource = source;
      try {
        // The numeric pass is authoritative for the amount. The callback lets
        // Android paint it before any slower diagnostic OCR completes.
        options.onValueDetected?.(candidate);
      } catch (error) {
        console.warn("[NVU GTO OCR] value promotion callback warning", error);
      }
    };

    // Numeric OCR is the minimum required evidence and must run first. The
    // old implementation ran the broad screen OCR first; on Android WebView
    // that pass could time out and return before the amount crop was attempted.
    const valueCrops = [
      { name: "landscape-modal", crop: VALUE_CROP },
      { name: "portrait-screen", crop: PORTRAIT_VALUE_CROP },
    ];
    for (const valueCrop of valueCrops) {
      if (value) break;
      try {
        const valueCanvas = await buildValueBandCanvas(file, valueCrop.crop);
        const valueText = await recognizeValueBand(worker, valueCanvas);
        const normalizedValueText = valueText.replace(/\s+/g, " ").trim();
        console.log("[NVU GTO OCR] value crop raw", valueCrop.name, valueText);
        const candidate = extractValueFromText(normalizedValueText, {
          allowImplicitCentsInGeneric: true,
        });
        console.log(
          "[NVU GTO OCR] value crop",
          valueCrop.name,
          normalizedValueText,
          candidate,
        );
        promoteValue(candidate, "numeric-crop");
        combinedText = `${combinedText} ${normalizedValueText}`.trim();
      } catch (error) {
        console.warn("[NVU GTO OCR] value crop warning", valueCrop.name, error);
      }
    }

    // Broad OCR is deliberately best-effort. It is useful for explicit
    // watched-ad/doubled-value evidence, but it must never erase a value that
    // the numeric pass already promoted or turn a timeout into a false failure.
    let broadText = "";
    try {
      await configureWorker(worker, {
        tessedit_pageseg_mode: "11",
        tessedit_char_whitelist: "",
        preserve_interword_spaces: "1",
        user_defined_dpi: "300",
      });
      const resultCanvas = await buildResultAnalysisCanvas(file);
      broadText = await recognizeWithWorker(worker, resultCanvas, 12_000);
      const normalizedResultText = broadText.replace(/\s+/g, " ").trim();
      promoteValue(extractValueFromText(normalizedResultText), "broad-diagnostic");
      combinedText = `${combinedText} ${normalizedResultText}`.trim();
    } catch (error) {
      console.warn("[NVU GTO OCR] broad diagnostic warning", error);
    }

    const screenEvidence = detectResultScreenEvidence(combinedText, value);
    const finalAdEvidence = detectDoubledByAdEvidence(combinedText);

    console.log("[NVU GTO OCR] receipt text", combinedText);
    console.log("[NVU GTO OCR] receipt value", value);
    console.log(
      "[NVU GTO OCR] doubled by ad",
      finalAdEvidence.detected,
      finalAdEvidence.evidence,
    );
    console.log("[NVU GTO OCR] result evidence", screenEvidence.evidence);

    return {
      value,
      doubledByAd: finalAdEvidence.detected,
      evidence: finalAdEvidence.evidence,
      // Print mode has two independent decisions: a valid received amount is
      // enough for the normal flow; only explicit ad/doubled-value evidence
      // blocks the trip. Screen-copy evidence remains diagnostic, not a gate.
      analysisOk: Boolean(value) && !finalAdEvidence.detected,
      rawText: combinedText,
    };
  } catch (error) {
    console.error("[NVU GTO OCR] receipt analysis error", error);
    return {
      value: null,
      doubledByAd: false,
      evidence: [],
      analysisOk: false,
      rawText: "",
    };
  } finally {
    if (worker) {
      try {
        await withTimeout(
          worker.terminate(),
          3_000,
          "Tempo excedido ao encerrar OCR.",
        );
      } catch (error) {
        console.warn("[NVU GTO OCR] worker termination warning", error);
      }
    }
  }
}

export async function extractGtoTripValue(file: File): Promise<string | null> {
  const analysis = await analyzeGtoTripReceipt(file);
  return analysis.value;
}

export const __gtoOcrTestUtils = {
  extractValueFromText,
  normalizeMonetaryCandidate,
  normalizeEvidenceText,
  detectDoubledByAdEvidence,
  detectResultScreenEvidence,
};
