/** A deadline releases the supervisor; retries retain the immutable request ID.
 * The underlying provider may finish later, so it must never allocate a new ID. */
export async function tripSyncDeadline<T>(work: Promise<T>, milliseconds: number, stage: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([work, new Promise<T>((_resolve, reject) => {
      timer = setTimeout(() => reject(Object.assign(new Error(`TRIP_SYNC_TIMEOUT:${stage}`), {
        code: "functions/deadline-exceeded", tripSyncStage: stage,
      })), milliseconds);
    })]);
  } finally { if (timer) clearTimeout(timer); }
}
