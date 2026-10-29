import { httpsCallable } from "firebase/functions";
import { auth, functions } from "../lib/firebase";
import {
  createAdminRejectionClient,
  type AdminRejectionCallableName,
  type AdminRejectionPayload,
  type AdminRejectionResult,
} from "./adminRejectionClientCore";

const client = createAdminRejectionClient({
  currentUid: async () => {
    await auth.authStateReady();
    return auth.currentUser?.uid ?? null;
  },
  refreshCurrentToken: async () => {
    const user = auth.currentUser;
    if (user) await user.getIdToken(true);
  },
  invoke: async (name: AdminRejectionCallableName, payload: AdminRejectionPayload) => {
    const callable = httpsCallable<Record<string, string>, AdminRejectionResult>(
      functions,
      name,
      { timeout: 25_000 },
    );
    return callable(payload);
  },
});

export const {
  rejectDriverRequestOnServer,
  rejectRecruitmentApplicationOnServer,
} = client;
