export class AsyncTimeoutError extends Error {
  readonly code = "NVU_ASYNC_TIMEOUT";

  constructor(message: string) {
    super(message);
    this.name = "AsyncTimeoutError";
  }
}

export const withTimeout = async <T>(
  promise: Promise<T>,
  timeoutMs: number,
  message: string,
): Promise<T> => {
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) return promise;

  let timeoutId: ReturnType<typeof setTimeout> | undefined;
  const timeoutPromise = new Promise<never>((_, reject) => {
    timeoutId = setTimeout(() => reject(new AsyncTimeoutError(message)), timeoutMs);
  });

  try {
    return await Promise.race([promise, timeoutPromise]);
  } finally {
    if (timeoutId !== undefined) clearTimeout(timeoutId);
  }
};

export const isAsyncTimeoutError = (error: unknown): error is AsyncTimeoutError =>
  error instanceof AsyncTimeoutError ||
  (typeof error === "object" &&
    error !== null &&
    (error as { code?: unknown }).code === "NVU_ASYNC_TIMEOUT");
