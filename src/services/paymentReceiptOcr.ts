import { withTimeout } from "../lib/asyncTimeout";
import { readReceiptAmounts, type ReceiptReading } from "../lib/receiptAmounts";

const TESSDATA = "/tessdata", WORKER = "/tesseract/worker.min.js", CORE = "/tesseract/core";
const MAX_SIDE = 1800;

/** Desenha a imagem (já reduzida) num canvas para o OCR. */
async function toCanvas(blob: Blob): Promise<HTMLCanvasElement> {
  const bitmap = await createImageBitmap(blob);
  const scale = Math.min(1, MAX_SIDE / Math.max(bitmap.width, bitmap.height)), canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(bitmap.width * scale)); canvas.height = Math.max(1, Math.round(bitmap.height * scale));
  const context = canvas.getContext("2d");
  if (!context) throw new Error("Não foi possível preparar a imagem.");
  context.fillStyle = "#fff"; context.fillRect(0, 0, canvas.width, canvas.height); context.drawImage(bitmap, 0, 0, canvas.width, canvas.height); bitmap.close?.();
  return canvas;
}

/**
 * Lê o texto do comprovante no próprio aparelho (nada sai do app para ser lido) e devolve os valores encontrados.
 * Falha (nunca trava): sem leitura, o chamador segue com "valor não lido".
 */
export async function readReceiptImage(blob: Blob): Promise<ReceiptReading & { text: string }> {
  let worker: { recognize: (image: HTMLCanvasElement) => Promise<{ data?: { text?: string } }>; terminate: () => Promise<unknown> } | null = null;
  try {
    const canvas = await toCanvas(blob);
    const module: any = await withTimeout(import("tesseract.js"), 8_000, "O leitor de comprovantes demorou para iniciar.");
    const create = module.createWorker || module.default?.createWorker;
    worker = await withTimeout(create("eng", undefined, { workerPath: WORKER, corePath: CORE, langPath: TESSDATA, gzip: false }), 15_000, "O modelo de leitura demorou para carregar.");
    const result = await withTimeout(worker!.recognize(canvas), 25_000, "A leitura do comprovante demorou demais.");
    const text = String(result?.data?.text || "");
    return { ...readReceiptAmounts(text), text };
  } catch {
    return { candidates: [], best: null, text: "" };
  } finally { try { await worker?.terminate(); } catch { /* ignore */ } }
}
