export type ConfirmedOperationCompletion = {
  /** Present only for a durable local request; completed is false until ACK. */
  pendingSync?: boolean;
  operationalRevision?: number;
  completed: boolean;
  alreadyCompleted?: boolean;
  jobId: string;
  status: string;
  progress: number;
  total: number;
};

/** The authenticated transaction owns completion. Queue maintenance follows
 * its ACK and can never turn a successful completion into a client failure. */
export async function finalizeOperationWithServerConfirmation(
  jobId: string,
  dependencies: {
    finalize: (jobId: string) => Promise<ConfirmedOperationCompletion>;
    onConfirmed: (completion: ConfirmedOperationCompletion) => void;
    discardPending: (jobId: string) => Promise<unknown>;
    onCleanupError?: (error: unknown) => void;
  },
): Promise<ConfirmedOperationCompletion> {
  const id = String(jobId || "").trim();
  if (!id) throw new Error("CANONICAL_OPERATION_REQUIRED");
  const completion = await dependencies.finalize(id);
  if (completion?.completed !== true || completion.jobId !== id ||
      completion.status !== "completed" ||
      !Number.isInteger(completion.progress) || completion.progress < 0 ||
      !Number.isInteger(completion.total) || completion.total < 0 ||
      (!completion.alreadyCompleted &&
        (completion.total < 1 || completion.progress !== completion.total))) {
    throw new Error("OPERATION_COMPLETION_NOT_SETTLED");
  }
  dependencies.onConfirmed(completion);
  void Promise.resolve().then(() => dependencies.discardPending(id))
    .catch((error) => dependencies.onCleanupError?.(error));
  return completion;
}
