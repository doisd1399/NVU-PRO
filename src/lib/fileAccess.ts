export const FILE_ACCESS_ERROR_CODE = "file/not-readable";

export const FILE_ACCESS_ERROR_MESSAGE =
  "O aplicativo não conseguiu manter acesso ao arquivo selecionado. Selecione a imagem novamente e aguarde o processamento terminar.";

export type SelectedFileSnapshot = {
  file: File;
  bytes: ArrayBuffer;
};

export class FileAccessError extends Error {
  readonly code: string;

  constructor(message = FILE_ACCESS_ERROR_MESSAGE, code = FILE_ACCESS_ERROR_CODE) {
    super(message);
    this.name = "FileAccessError";
    this.code = code;
  }
}

const readErrorPatterns = [
  "requested file could not be read",
  "permission problems",
  "reference to a file was acquired",
  "could not read file",
  "could not be read",
  "file is not readable",
  "not readable",
];

export const isFileAccessError = (error: unknown): boolean => {
  if (error instanceof FileAccessError) return true;

  const candidate = error as { name?: unknown; code?: unknown; message?: unknown };
  const name = String(candidate?.name || "").toLowerCase();
  const code = String(candidate?.code || "").toLowerCase();
  const message = String(candidate?.message || "").toLowerCase();

  if (
    name === "notreadableerror" ||
    code === FILE_ACCESS_ERROR_CODE
  ) {
    return true;
  }

  return readErrorPatterns.some((pattern) => message.includes(pattern));
};

export const normalizeFileAccessError = (error: unknown): Error => {
  if (error instanceof FileAccessError) return error;
  if (isFileAccessError(error)) return new FileAccessError();
  return error instanceof Error
    ? error
    : new Error("Não foi possível processar o arquivo selecionado.");
};

const inferMimeTypeFromName = (fileName: string): string => {
  const extension = fileName.split(".").pop()?.toLowerCase();
  if (extension === "jpg" || extension === "jpeg") return "image/jpeg";
  if (extension === "png") return "image/png";
  if (extension === "webp") return "image/webp";
  if (extension === "heic") return "image/heic";
  if (extension === "heif") return "image/heif";
  return "";
};

/**
 * Copies a picker-backed File into browser-owned memory immediately.
 *
 * Android galleries and document providers can expose temporary content URIs.
 * Reading the original File later, or from multiple consumers at the same time,
 * may fail with NotReadableError after the picker permission is released.
 */
export const snapshotSelectedFile = async (
  selectedFile: File,
  options: {
    maxBytes?: number;
    fallbackName?: string;
  } = {},
): Promise<SelectedFileSnapshot> => {
  const maxBytes = options.maxBytes;

  if (maxBytes && selectedFile.size > maxBytes) {
    throw new FileAccessError(
      `Arquivo original muito grande. O limite máximo é de ${Math.floor(
        maxBytes / (1024 * 1024),
      )} MB.`,
      "file/too-large",
    );
  }

  try {
    // Read exactly once while the native picker permission is still valid.
    const bytes = await selectedFile.arrayBuffer();

    if (bytes.byteLength <= 0) {
      throw new FileAccessError(
        "O arquivo selecionado está vazio ou não pôde ser aberto.",
        "file/empty",
      );
    }

    if (maxBytes && bytes.byteLength > maxBytes) {
      throw new FileAccessError(
        `Arquivo original muito grande. O limite máximo é de ${Math.floor(
          maxBytes / (1024 * 1024),
        )} MB.`,
        "file/too-large",
      );
    }

    const name =
      String(selectedFile.name || "").trim() ||
      options.fallbackName ||
      `imagem-${Date.now()}`;
    const type =
      String(selectedFile.type || "").trim().toLowerCase() ||
      inferMimeTypeFromName(name);

    const file = new File([bytes], name, {
      type,
      lastModified: selectedFile.lastModified || Date.now(),
    });

    return { file, bytes };
  } catch (error) {
    throw normalizeFileAccessError(error);
  }
};
