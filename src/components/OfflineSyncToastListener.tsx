import { useEffect } from "react";
import { toast } from "sonner";

export default function OfflineSyncToastListener() {
  useEffect(() => {
    const queued = () => toast.info("Viagem salva offline", { description: "Aguardando conexão para validar." });
    const start = (event: Event) => {
      const count = Number((event as CustomEvent)?.detail?.count || 0);
      toast.loading(count > 1 ? `Enviando ${count} viagens pendentes…` : "Enviando viagem pendente…", { id: "nvu-offline-sync" });
    };
    const finish = (event: Event) => {
      const { synced = 0, remaining = 0 } = (event as CustomEvent)?.detail || {};
      if (remaining > 0) {
        toast.warning("Sincronização pendente", { id: "nvu-offline-sync", description: `${remaining} viagem(ns) aguardando validação.` });
      } else if (synced > 0) {
        toast.success(synced > 1 ? "Viagens validadas" : "Viagem validada", { id: "nvu-offline-sync", description: "Registro confirmado pelo sistema." });
      } else {
        toast.dismiss("nvu-offline-sync");
      }
    };
    window.addEventListener("nvu-offline-trip-queued", queued);
    window.addEventListener("nvu-offline-sync-start", start);
    window.addEventListener("nvu-offline-sync-finish", finish);
    return () => {
      window.removeEventListener("nvu-offline-trip-queued", queued);
      window.removeEventListener("nvu-offline-sync-start", start);
      window.removeEventListener("nvu-offline-sync-finish", finish);
    };
  }, []);
  return null;
}
