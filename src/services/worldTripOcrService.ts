import { validateProReceiptEvidence } from "./pro-universal/proReceiptAdapters";

type WorldSimulatorCode = "WTDS" | "WBDS";

function normalizeWorldReceiptText(text: string): string {
  return String(text || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toUpperCase();
}

function parseWorldCurrencyToken(raw: string): number | null {
  const cleaned = String(raw || "").replace(/[^0-9.,]/g, "");
  if (!cleaned) return null;
  const comma = cleaned.lastIndexOf(",");
  const dot = cleaned.lastIndexOf(".");
  const separator = Math.max(comma, dot);
  const fraction = separator >= 0 ? cleaned.slice(separator + 1) : "";
  const decimal = fraction.length === 1 || fraction.length === 2;
  const whole = decimal ? cleaned.slice(0, separator) : cleaned;
  const amount = Number(whole.replace(/[.,]/g, "")) + Number(decimal ? `0.${fraction.padEnd(2, "0")}` : 0);
  return Number.isFinite(amount) && amount > 0 && amount <= 1_000_000_000 ? amount : null;
}

function normalizeRoiLine(line: string): string {
  return String(line || "")
    .replace(/\s*([.,])\s*/g, "$1")
    .replace(/(?<=\d)\s+(?=\d)/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Parse only monetary-looking lines emitted by the spatial payout ROI.
 * The ROI is the location proof; a decimal/currency-shaped line is the
 * semantic proof. Bare OCR noise such as `4` or `2 6 6` is discarded rather
 * than competing with the payout candidate.
 */
export function parseWorldTripRoiValue(rawText: string): string | null {
  const candidates = Array.from(String(rawText || "").split(/\r?\n/))
    .map(normalizeRoiLine)
    .flatMap((line) => Array.from(line.matchAll(/(?:R\s*\$|\$)?\s*([0-9][0-9.,]*)/gi)))
    .map((match) => match[1])
    .filter((token) => /[.,]\d{2}$/.test(token))
    .map(parseWorldCurrencyToken)
    .filter((value): value is number => value !== null && value >= 1);
  const unique = Array.from(new Set(candidates.map((value) => Math.round(value * 100))));
  if (unique.length !== 1) return null;
  return (unique[0] / 100).toLocaleString("pt-BR", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

/**
 * WTDS/WBDS render the green payout in a separate visual column. Tesseract can
 * correctly read both the label and the value while emitting them on distant
 * OCR lines. Keep the generic strict parser first, then allow a simulator-only
 * fallback when the result screen is independently proven and every
 * currency-prefixed payout token agrees on one value. Bare EXP/damage numbers
 * are intentionally ignored.
 */
export function parseWorldTripValue(text: string, simulator: WorldSimulatorCode): string | null {
  const result = validateProReceiptEvidence(simulator === "WTDS" ? "wtds" : "wbds", text);
  let amount = result.validation.decision === "accept" && result.evidence.resultScreenConfirmed
    ? result.validation.amount
    : null;

  if (amount === null) {
    const normalized = normalizeWorldReceiptText(text);
    const screenConfirmed = normalized.includes("RESULTADOS")
      && normalized.includes("GANHOS DA VIAGEM")
      && normalized.includes("DANOS")
      && normalized.includes("BONUS VIDEO ADS");
    const bonusSafe = result.evidence.bonusEvidence === "NONE"
      || result.evidence.bonusEvidence === "ZERO_LABEL";
    if (!screenConfirmed || !bonusSafe) return null;

    const tokens = Array.from(text.matchAll(/(?:R\s*\$|\$)\s*([0-9][0-9.,]*)/gi))
      .map((match) => parseWorldCurrencyToken(match[1]))
      .filter((value): value is number => value !== null);
    const unique = Array.from(new Set(tokens.map((value) => Math.round(value * 100))));
    if (unique.length !== 1) return null;
    amount = unique[0] / 100;
  }

  if (amount === null || amount <= 0 || amount > 1_000_000_000) return null;
  return amount.toLocaleString("pt-BR", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

export async function extractWorldTripValue(file: File, simulator: string): Promise<string | null> {
  if (simulator !== "WTDS" && simulator !== "WBDS") return null;
  let worker: any;
  let bitmap: ImageBitmap | null = null;
  let image: HTMLImageElement | null = null;
  let url: string | null = null;
  const debug = (globalThis as any).__NVU_WORLD_OCR_DEBUG;
  try {
    let source: CanvasImageSource;
    let width: number;
    let height: number;
    if (typeof createImageBitmap === "function") {
      try { bitmap = await createImageBitmap(file); } catch { /* Android file fallback below */ }
    }
    if (bitmap) {
      source = bitmap;
      width = bitmap.width;
      height = bitmap.height;
    } else {
      url = URL.createObjectURL(file);
      image = new Image();
      image.src = url;
      await new Promise<void>((resolve, reject) => {
        image!.onload = () => resolve();
        image!.onerror = () => reject(new Error("Imagem inválida."));
      });
      source = image;
      width = image.naturalWidth;
      height = image.naturalHeight;
    }
    if (debug) debug.image = { width, height, simulator };
    if (width < 400 || height < 300) return null;
    // Normalize both down and up so small/compressed screenshots reach the
    // same OCR scale while preserving their aspect ratio.
    const scale = 2000 / Math.max(width, height);
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(width * scale);
    canvas.height = Math.round(height * scale);
    const ctx = canvas.getContext("2d", { willReadFrequently: true });
    if (!ctx) return null;
    // Avoid smoothing away thin green glyphs when a compressed screenshot is
    // being enlarged for OCR; downscaled inputs retain normal interpolation.
    ctx.imageSmoothingEnabled = scale <= 1;
    ctx.drawImage(source, 0, 0, canvas.width, canvas.height);
    const module: any = await import("tesseract.js");
    const tesseract = module.default || module;
    const createWorker = tesseract.createWorker || module.createWorker;
    worker = await createWorker("eng", 1, { langPath: "/tessdata" });
    await worker.setParameters({
      tessedit_pageseg_mode: tesseract.PSM?.SPARSE_TEXT ?? module.PSM?.SPARSE_TEXT ?? "11",
      preserve_interword_spaces: "1",
    });
    const text = (await worker.recognize(canvas))?.data?.text || "";
    if (debug) debug.full = { text };
    // IMPORTANT: never promote a value from full-screen OCR for WTDS/WBDS.
    // Tesseract may flatten the 2-D result panel into a misleading line order
    // (for example, placing the HUD's `FPS 80` immediately after
    // `Ganhos da Viagem`). That made FPS/EXP/level values look like payout.
    // Full-screen OCR is context evidence only; the amount must come from the
    // payout ROI below, which is physically bounded away from the FPS/EXP HUD.
    const wholeScreenValue = parseWorldTripValue(text, simulator);
    if (debug) debug.fullParsedDiagnosticOnly = wholeScreenValue;

    // WTDS result panels are often captured in landscape with a dark HUD around
    // them. A full-screen sparse OCR pass can miss the green amount even when
    // the text is perfectly readable. Retry only the central result panel.
    const panel = document.createElement("canvas");
    panel.width = Math.round(canvas.width * 0.62);
    panel.height = Math.round(canvas.height * 0.68);
    const panelContext = panel.getContext("2d", { willReadFrequently: true });
    if (!panelContext) return null;
    panelContext.drawImage(
      canvas,
      Math.round(canvas.width * 0.19),
      Math.round(canvas.height * 0.16),
      panel.width,
      panel.height,
      0,
      0,
      panel.width,
      panel.height,
    );
    await worker.setParameters({
      tessedit_pageseg_mode: tesseract.PSM?.SPARSE_TEXT ?? module.PSM?.SPARSE_TEXT ?? "11",
      tessedit_char_whitelist: "0123456789.,:$€EURBRLGTANHOSDAV IAGEMTOTALDANOSACARGABONUSVIDEO",
      preserve_interword_spaces: "1",
      user_defined_dpi: "300",
    });
    const panelText = (await worker.recognize(panel))?.data?.text || "";
    if (debug) debug.panel = { text: panelText, width: panel.width, height: panel.height };
    // Same rule for broad panel OCR: use it to prove that this is the result
    // screen, never as the source of the monetary value. OCR line ordering is
    // not a trustworthy substitute for spatial association.
    const panelValue = parseWorldTripValue(panelText, simulator);
    if (debug) debug.panelParsedDiagnosticOnly = panelValue;

    // WTDS and WBDS share the exact same result-screen geometry. On real
    // Android screenshots Tesseract can lose the currency symbol/green payout
    // even though the surrounding result panel is readable. Confirm the
    // screen from the broad panel first, then OCR only the payout row. The ROI
    // deliberately stops before the EXP column, so EXP/level/FPS cannot become
    // earnings. This path is local to WTDS/WBDS.
    const contextText = `${text}\n${panelText}`;
    const normalizedContext = normalizeWorldReceiptText(contextText);
    const resultTitleConfirmed = normalizedContext.includes("RESULTADOS")
      || (normalizedContext.includes("TOTAL") && normalizedContext.includes("EXP"));
    const resultContextConfirmed = resultTitleConfirmed
      && normalizedContext.includes("GANHOS")
      && (normalizedContext.includes("DANOS") || normalizedContext.includes("CARGA"))
      && (normalizedContext.includes("BONUS") || normalizedContext.includes("ADS") || normalizedContext.includes("ESTACIONAMENTO"));
    const contextEvidence = validateProReceiptEvidence(simulator === "WTDS" ? "wtds" : "wbds", contextText);
    const panelBonusSafe = contextEvidence.evidence.bonusEvidence === "NONE"
      || contextEvidence.evidence.bonusEvidence === "ZERO_LABEL"
      || !normalizedContext.match(/BONUS(?: VIDEO)? ADS\s*[:]?\s*[1-9]/);

    if (resultContextConfirmed && panelBonusSafe) {
      // Coordinates are normalized against the complete WTDS/WBDS landscape
      // screenshot. The real Resultados fixture places the green payout in
      // the Total column around x=52-64%, y=34-45%; EXP is farther right.
      const payout = document.createElement("canvas");
      // Keep the crop on the Total/payout column only. The left edge is far
      // to the right of the FPS HUD and the right edge stops before EXP.
      // This geometry is shared by WTDS/WBDS result screens.
      const roiX = Math.round(canvas.width * 0.50);
      const roiY = Math.round(canvas.height * 0.35);
      const roiW = Math.round(canvas.width * 0.14);
      const roiH = Math.round(canvas.height * 0.08);
      if (debug) debug.roi = { x: roiX, y: roiY, width: roiW, height: roiH, canvasWidth: canvas.width, canvasHeight: canvas.height };
      const zoom = 4;
      payout.width = Math.max(1, roiW * zoom);
      payout.height = Math.max(1, roiH * zoom);
      const payoutContext = payout.getContext("2d", { willReadFrequently: true });
      if (payoutContext) {
        // First OCR the raw payout crop. The real WTDS fixture is much more
        // legible this way than after aggressive green thresholding.
        payoutContext.imageSmoothingEnabled = true;
        payoutContext.drawImage(canvas, roiX, roiY, roiW, roiH, 0, 0, payout.width, payout.height);
        await worker.setParameters({
          tessedit_pageseg_mode: tesseract.PSM?.SPARSE_TEXT ?? module.PSM?.SPARSE_TEXT ?? "11",
          tessedit_char_whitelist: "0123456789.,$R ",
          preserve_interword_spaces: "1",
          user_defined_dpi: "300",
        });
        const rawPayoutResult = await worker.recognize(payout);
        const rawPayoutText = rawPayoutResult?.data?.text || "";
        if (debug) debug.rawRoiText = rawPayoutText;
        if (debug) {
          debug.rawRoiTokens = (rawPayoutResult?.data?.words || []).map((word: any) => ({
            text: word.text,
            confidence: word.confidence,
            bbox: word.bbox,
          }));
          debug.rawRoiParsedValue = parseWorldTripRoiValue(rawPayoutText);
        }
        const rawRoiValue = parseWorldTripRoiValue(rawPayoutText);
        if (rawRoiValue !== null) return rawRoiValue;

        // Compression/GPU variants can make the green digits low contrast.
        // Threshold only as a secondary pass, still inside the same safe ROI.
        payoutContext.imageSmoothingEnabled = false;
        const payoutPixels = payoutContext.getImageData(0, 0, payout.width, payout.height);
        for (let index = 0; index < payoutPixels.data.length; index += 4) {
          const red = payoutPixels.data[index];
          const green = payoutPixels.data[index + 1];
          const blue = payoutPixels.data[index + 2];
          // The payout is bright green. Keep green-dominant pixels and discard
          // the HUD/background so compression artifacts do not swamp digits.
          const greenDigit = green >= 60 && green >= red * 1.18 && green >= blue * 1.05;
          const value = greenDigit ? 0 : 255;
          payoutPixels.data[index] = value;
          payoutPixels.data[index + 1] = value;
          payoutPixels.data[index + 2] = value;
          payoutPixels.data[index + 3] = 255;
        }
        payoutContext.putImageData(payoutPixels, 0, 0);
        if (debug) debug.roiImageDataUrl = payout.toDataURL("image/png");
        await worker.setParameters({
          tessedit_pageseg_mode: tesseract.PSM?.SINGLE_LINE ?? module.PSM?.SINGLE_LINE ?? "7",
          tessedit_char_whitelist: "0123456789.,$R ",
          preserve_interword_spaces: "1",
          user_defined_dpi: "300",
        });
        const payoutResult = await worker.recognize(payout);
        const payoutText = payoutResult?.data?.text || "";
        if (debug) debug.roiText = payoutText;
        if (debug) {
          debug.roiTokens = (payoutResult?.data?.words || []).map((word: any) => ({
            text: word.text,
            confidence: word.confidence,
            bbox: word.bbox,
          }));
          debug.roiParsedValue = parseWorldTripRoiValue(payoutText);
        }
        const roiValue = parseWorldTripRoiValue(payoutText);
        if (roiValue !== null) return roiValue;
      }
    }

    // Fail closed. If the spatially constrained payout ROI cannot produce one
    // unambiguous monetary value, require manual confirmation instead of
    // falling back to broad OCR. This is intentionally shared by WTDS/WBDS.
    return null;
  } catch (error) {
    if (debug) debug.error = String(error);
    console.warn("[NVU World receipt OCR] read failed", simulator, error);
    return null;
  } finally {
    bitmap?.close();
    if (url) URL.revokeObjectURL(url);
    if (worker) await worker.terminate().catch(() => undefined);
  }
}
