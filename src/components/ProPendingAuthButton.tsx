import { useState } from "react";
import { toast } from "sonner";
import { SimpleAutomation } from "../lib/simpleAutomationNative";
import { authenticateNativeForPendingProTrip } from "../services/googleAuthService";
import { pendingRetryFeedback } from "../lib/proPendingPresentation";

let repairInFlight = false;

/** A durable action for a receipt blocked by a missing or different native user. */
export function ProPendingAuthButton({ driverId, attemptIds = [] }: { driverId: string; attemptIds?: string[] }) {
  const [loading, setLoading] = useState(false);

  const authenticate = async () => {
    if (repairInFlight || loading) return;
    repairInFlight = true;
    setLoading(true);
    try {
      await authenticateNativeForPendingProTrip(driverId);
      // The native retry is attempt-scoped (an empty id is refused on purpose), so replay each saved attempt by its id.
      const ids = [...new Set(attemptIds.filter(Boolean))];
      if (!ids.length) { toast.success("Conta confirmada. O envio da viagem salva será retomado automaticamente."); return; }
      let feedback = pendingRetryFeedback("pending-retry-requested");
      for (const attemptId of ids) {
        const result = await SimpleAutomation.retryPending({ attemptId });
        if (result.status === "auth-required") throw new Error("PRO_PENDING_NATIVE_USER_MISMATCH");
        if (result.status === "retry-unavailable") throw new Error("PRO_PENDING_RETRY_UNAVAILABLE");
        if (result.status !== "pending-retry-requested") feedback = pendingRetryFeedback(result.status);
      }
      toast[feedback.kind](feedback.message);
    } catch (error) {
      const message = String(error instanceof Error ? error.message : error);
      toast.error(message.includes("MISMATCH")
        ? "Selecione a conta Google do motorista desta viagem. O recibo continua salvo."
        : "Não foi possível autenticar agora. A viagem continua salva neste aparelho.");
    } finally {
      repairInFlight = false;
      setLoading(false);
    }
  };

  return (
    <button type="button" onClick={() => void authenticate()} disabled={loading}
      className="mt-2 rounded-lg bg-amber-400 px-3 py-2 text-xs font-semibold text-slate-950 disabled:opacity-60">
      {loading ? "Autenticando…" : "Autenticar para enviar viagem salva"}
    </button>
  );
}
