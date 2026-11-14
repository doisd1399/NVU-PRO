import { useState } from "react";
import { toast } from "sonner";
import { SimpleAutomation } from "../lib/simpleAutomationNative";
import { pendingRetryFeedback } from "../lib/proPendingPresentation";

/** Replays the stored attempt; the native transaction owns the only write. */
export function ProPendingRetryButton({ attemptId, recoverContract = false }: { attemptId: string; recoverContract?: boolean }) {
  const [loading, setLoading] = useState(false);

  const retry = async () => {
    if (loading) return;
    setLoading(true);
    try {
      const result = await SimpleAutomation.retryPending({ attemptId });
      const feedback = pendingRetryFeedback(result.status);
      toast[feedback.kind](feedback.message);
    } catch {
      toast.error("Não foi possível iniciar a tentativa agora. A viagem continua salva.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <button type="button" onClick={() => void retry()} disabled={loading}
      className="mt-2 rounded-lg border border-amber-500 px-3 py-2 text-xs font-semibold text-amber-800 disabled:opacity-60 dark:text-amber-200">
      {loading ? "Verificando…" : recoverContract ? "Verificar e reenviar" : "Tentar enviar agora"}
    </button>
  );
}
