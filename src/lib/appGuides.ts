// Guias do app (Motorista e Empresário). Cada guia tem uma cópia que vai junto com o app (public/guias) e pode ser
// substituída/removida pelo Painel Sênior SEM trocar o APK: o arquivo novo fica no Firebase Storage e a ficha no Firestore.
// Este módulo só tem regras puras (sem Firebase) para poderem ser testadas e usadas pela tela e pelo serviço.

export type AppGuideId = "driver" | "company";

export interface AppGuideDefinition {
  id: AppGuideId;
  title: string;
  audience: string;
  /** Arquivo que acompanha o app (mesma origem). */
  bundledUrl: string;
  bundledFileName: string;
}

export const APP_GUIDES: readonly AppGuideDefinition[] = [
  { id: "driver", title: "Guia do Motorista", audience: "Para motoristas", bundledUrl: "/guias/NVU-Guia-do-Motorista.pdf", bundledFileName: "NVU-Guia-do-Motorista.pdf" },
  { id: "company", title: "Guia do Empresário", audience: "Para empresários", bundledUrl: "/guias/NVU-Guia-do-Empresario.pdf", bundledFileName: "NVU-Guia-do-Empresario.pdf" },
] as const;

export const APP_GUIDES_COLLECTION = "app_guides";
export const APP_GUIDES_STORAGE_ROOT = "app-guides";
export const APP_GUIDE_MAX_BYTES = 15 * 1024 * 1024;

/** Ficha gravada pelo Painel Sênior em `app_guides/{id}`. */
export interface AppGuideRecord {
  id: AppGuideId;
  fileName: string;
  storagePath: string;
  downloadUrl: string;
  size: number;
  contentType: "application/pdf";
  updatedAt?: unknown;
  updatedBy?: string;
}

export interface ResolvedAppGuide {
  definition: AppGuideDefinition;
  /** "uploaded" = enviado pelo Sênior; "bundled" = o que acompanha esta versão do app. */
  source: "uploaded" | "bundled";
  url: string;
  fileName: string;
  size: number | null;
  updatedAtMs: number | null;
  record: AppGuideRecord | null;
}

export const isAppGuideId = (value: unknown): value is AppGuideId => value === "driver" || value === "company";

export const sanitizeGuideFileName = (name: string): string => {
  const base = String(name || "").normalize("NFD").replace(/[̀-ͯ]/g, "")
    .replace(/\.pdf$/i, "").replace(/[^A-Za-z0-9._-]+/g, "-").replace(/-+/g, "-").replace(/^[-.]+|[-.]+$/g, "").slice(0, 80);
  return `${base || "guia"}.pdf`;
};

export const buildGuideStoragePath = (id: AppGuideId, fileName: string, now = Date.now()): string =>
  `${APP_GUIDES_STORAGE_ROOT}/${id}/${now}-${sanitizeGuideFileName(fileName)}`;

/** Confere o arquivo antes de enviar. `head` são os primeiros bytes (o PDF começa com "%PDF-"). */
export const validateGuideFile = (file: { name: string; size: number; type?: string }, head: Uint8Array): string | null => {
  if (!file || !Number.isFinite(file.size) || file.size <= 0) return "O arquivo está vazio.";
  if (file.size > APP_GUIDE_MAX_BYTES) return "O arquivo passa de 15 MB. Reduza o PDF e tente de novo.";
  const looksPdf = head.length >= 5 && String.fromCharCode(head[0], head[1], head[2], head[3], head[4]) === "%PDF-";
  if (!looksPdf) return "Envie um arquivo PDF.";
  if (file.type && file.type !== "application/pdf") return "Envie um arquivo PDF.";
  return null;
};

const timeMs = (value: unknown): number | null => {
  if (!value) return null;
  if (value instanceof Date) return value.getTime();
  const toDate = (value as { toDate?: () => Date }).toDate;
  if (typeof toDate === "function") { try { return toDate.call(value).getTime(); } catch { return null; } }
  const seconds = (value as { seconds?: unknown }).seconds;
  if (typeof seconds === "number") return seconds * 1000;
  return typeof value === "number" && Number.isFinite(value) ? value : null;
};

/** Lê uma ficha vinda do Firestore. Ficha incompleta ou de outro formato vale como "sem arquivo enviado". */
export const readGuideRecord = (id: string, data: unknown): AppGuideRecord | null => {
  if (!isAppGuideId(id) || !data || typeof data !== "object") return null;
  const row = data as Record<string, unknown>;
  const downloadUrl = typeof row.downloadUrl === "string" ? row.downloadUrl.trim() : "";
  const storagePath = typeof row.storagePath === "string" ? row.storagePath.trim() : "";
  const fileName = typeof row.fileName === "string" ? row.fileName.trim() : "";
  if (!/^https:\/\//i.test(downloadUrl) || !storagePath.startsWith(`${APP_GUIDES_STORAGE_ROOT}/${id}/`) || !fileName) return null;
  const size = typeof row.size === "number" && Number.isFinite(row.size) ? row.size : 0;
  return { id, fileName, storagePath, downloadUrl, size, contentType: "application/pdf", updatedAt: row.updatedAt, updatedBy: typeof row.updatedBy === "string" ? row.updatedBy : undefined };
};

export const resolveAppGuide = (definition: AppGuideDefinition, record: AppGuideRecord | null | undefined): ResolvedAppGuide =>
  record
    ? { definition, source: "uploaded", url: record.downloadUrl, fileName: record.fileName, size: record.size || null, updatedAtMs: timeMs(record.updatedAt), record }
    : { definition, source: "bundled", url: definition.bundledUrl, fileName: definition.bundledFileName, size: null, updatedAtMs: null, record: null };

export const formatGuideSize = (bytes: number | null): string => {
  if (!bytes || bytes <= 0) return "";
  return bytes >= 1024 * 1024 ? `${(bytes / 1024 / 1024).toFixed(1).replace(".", ",")} MB` : `${Math.max(1, Math.round(bytes / 1024))} KB`;
};
