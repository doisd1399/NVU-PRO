import { isSimpleAutomationNativeAvailable, SimpleAutomation } from "../lib/simpleAutomationNative";

const notifyQueueChanged = () => {
  if (typeof window !== "undefined") {
    window.dispatchEvent(new CustomEvent("nvu-completed-operation-queue-cleaned"));
  }
};

export async function discardCompletedOperationQueue(jobId: string): Promise<void> {
  await confirmCompletedOperationQueueCleanup(jobId);
}

export async function confirmCompletedOperationQueueCleanup(jobId: string): Promise<boolean> {
  if (!isSimpleAutomationNativeAvailable()) return true;
  // Android independently reads Source.SERVER and verifies the authenticated
  // owner and immutable operation scope; no client counter authorizes deletion.
  const result = await SimpleAutomation.discardCompletedOperationQueue({ jobId });
  if (result.verified !== true) return false;
  notifyQueueChanged();
  return true;
}

export async function reconcileCompletedOperationQueues(): Promise<void> {
  if (!isSimpleAutomationNativeAvailable()) return;
  await SimpleAutomation.reconcileCompletedOperationQueues();
  notifyQueueChanged();
}
