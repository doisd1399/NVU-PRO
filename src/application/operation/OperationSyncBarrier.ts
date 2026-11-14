// Keep the trip engine independent from Firebase operational adapters. The
// runtime configures this once; isolated engines can inject their own port.
let pendingStart = (_uid: string, _jobId: string) => false;
export function configureOperationSyncBarrier(reader: typeof pendingStart) { pendingStart = reader; }
export function isOperationStartPending(uid: string, jobId: string) { return pendingStart(uid, jobId); }
