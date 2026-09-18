import type { OperationResultData } from "../components/OperationResultModal";

export const OPERATION_RESULT_READY_EVENT = "nvu-operation-result-ready";
const STORAGE_KEY = "nvu.operation-result-ready.v1";
const MAX_AGE_MS = 10 * 60 * 1000;

type OperationResultHandoff = {
  userId: string;
  jobId: string;
  data: OperationResultData;
  createdAt: number;
};

let latestHandoff: OperationResultHandoff | null = null;

function isValidHandoff(
  value: unknown,
  userId: string,
): value is OperationResultHandoff {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Partial<OperationResultHandoff>;
  return Boolean(
    candidate.userId === userId
      && candidate.jobId
      && candidate.data
      && typeof candidate.createdAt === "number"
      && Date.now() - candidate.createdAt <= MAX_AGE_MS,
  );
}

function readStoredHandoff(userId: string): OperationResultHandoff | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.sessionStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed: unknown = JSON.parse(raw);
    return isValidHandoff(parsed, userId) ? parsed : null;
  } catch {
    return null;
  }
}

export function publishOperationCompletionResult(input: {
  userId: string;
  jobId: string;
  data: OperationResultData;
}): void {
  const handoff: OperationResultHandoff = {
    ...input,
    createdAt: Date.now(),
  };
  latestHandoff = handoff;
  if (typeof window === "undefined") return;
  try {
    window.sessionStorage.setItem(STORAGE_KEY, JSON.stringify(handoff));
  } catch {
    // The in-memory event remains sufficient while the Dashboard is mounted.
  }
  window.dispatchEvent(
    new CustomEvent<OperationResultHandoff>(OPERATION_RESULT_READY_EVENT, {
      detail: handoff,
    }),
  );
}

export function consumeOperationCompletionResult(
  userId: string,
): OperationResultHandoff | null {
  const candidate = isValidHandoff(latestHandoff, userId)
    ? latestHandoff
    : readStoredHandoff(userId);
  if (!candidate) return null;
  latestHandoff = null;
  if (typeof window !== "undefined") {
    try {
      window.sessionStorage.removeItem(STORAGE_KEY);
    } catch {
      // Ignore storage cleanup failures; the in-memory value was consumed.
    }
  }
  return candidate;
}
