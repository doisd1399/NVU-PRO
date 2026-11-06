import React, { useEffect, useRef, useState } from "react";
import { Download, FileText, Loader2, Trash2, Upload } from "lucide-react";
import { toast } from "sonner";
import { useSessionStore } from "../../context/AppContext";
import { APP_GUIDES, formatGuideSize, resolveAppGuide, type AppGuideId } from "../../lib/appGuides";
import { downloadAppGuide } from "../../lib/appGuidesDownload";
import { deleteAppGuide, uploadAppGuide, watchAppGuides, type AppGuideRecords } from "../../services/appGuidesService";
import { ManagementDialog } from "./management/ManagementDialog";
import "./management/ManagementDashboard.css";
import "./management/OperationInfoSheet.css";
import "./management/SeniorSheets.css";

const formatDate = (ms: number | null) => ms ? new Date(ms).toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit", year: "numeric" }) : "";

/**
 * Painel Sênior › Opções › Gerenciar guias. Enviar ou excluir vale para todos os usuários na hora e não depende da versão do APK:
 * o app só lê a ficha `app_guides/{guia}`; sem ficha, mostra o guia que acompanha a versão instalada.
 */
export function AppGuidesManagerModal({ onClose }: { onClose: () => void }) {
  const { currentUser } = useSessionStore();
  const [records, setRecords] = useState<AppGuideRecords>({});
  const [loaded, setLoaded] = useState(false);
  const [busyId, setBusyId] = useState<AppGuideId | null>(null);
  const [confirmId, setConfirmId] = useState<AppGuideId | null>(null);
  const inputs = useRef<Partial<Record<AppGuideId, HTMLInputElement | null>>>({});

  useEffect(() => watchAppGuides(next => { setRecords(next); setLoaded(true); }, () => setLoaded(true)), []);

  const pick = async (id: AppGuideId, file: File | undefined) => {
    if (!file || busyId) return;
    setBusyId(id);
    try {
      await uploadAppGuide(id, file, currentUser?.id || "", records[id]);
      toast.success("Guia enviado. Todos os usuários já veem o novo arquivo.");
    } catch (error) {
      toast.error(error instanceof Error && error.message ? error.message : "Não foi possível enviar o guia.");
    } finally { setBusyId(null); const input = inputs.current[id]; if (input) input.value = ""; }
  };

  const remove = async (id: AppGuideId) => {
    const record = records[id];
    if (!record || busyId) return;
    setBusyId(id);
    try {
      await deleteAppGuide(id, record);
      setConfirmId(null);
      toast.success("Guia excluído. O app volta a mostrar o guia que acompanha a versão instalada.");
    } catch (error) {
      toast.error(error instanceof Error && error.message ? error.message : "Não foi possível excluir o guia.");
    } finally { setBusyId(null); }
  };

  const open = async (id: AppGuideId) => {
    try { await downloadAppGuide(resolveAppGuide(APP_GUIDES.find(guide => guide.id === id)!, records[id])); }
    catch { toast.error("Não foi possível baixar o guia."); }
  };

  return (
    <ManagementDialog title="Gerenciar guias" variant="sheet" busy={Boolean(busyId)} onClose={onClose}>
      <div className="nvu-senior-sheet" data-testid="senior-guides-sheet">
        <p className="nvu-senior-note">Os guias aparecem na página Manual de todos os usuários. Enviar um PDF novo substitui o atual na hora, sem precisar de uma nova versão do APK.</p>
        <div className="nvu-senior-guides">
          {APP_GUIDES.map(definition => {
            const record = records[definition.id];
            const guide = resolveAppGuide(definition, record);
            const busy = busyId === definition.id;
            const detail = guide.source === "uploaded"
              ? [`Enviado pelo Painel Sênior`, formatDate(guide.updatedAtMs), formatGuideSize(guide.size)].filter(Boolean).join(" · ")
              : "Guia padrão que acompanha o app";
            return (
              <div className="nvu-senior-guide" key={definition.id} data-guide={definition.id} data-source={guide.source}>
                <FileText size={26} strokeWidth={1.6} aria-hidden="true" />
                <div><strong>{definition.title}</strong><small>{loaded ? detail : "Carregando..."}</small><small>{guide.fileName}</small></div>
                <div className="nvu-senior-guide-actions">
                  <button type="button" className="nvu-senior-mini" aria-label={`Baixar ${definition.title}`} onClick={() => void open(definition.id)} disabled={busy}><Download size={15} aria-hidden="true" /></button>
                  <button type="button" className="nvu-senior-mini" data-tone="accent" disabled={busy || Boolean(busyId)} onClick={() => inputs.current[definition.id]?.click()}>
                    {busy ? <Loader2 size={15} className="animate-spin" aria-hidden="true" /> : <Upload size={15} aria-hidden="true" />}{busy ? "Enviando..." : "Enviar novo"}
                  </button>
                  {record && (confirmId === definition.id
                    ? <button type="button" className="nvu-senior-mini" data-tone="danger" disabled={Boolean(busyId)} onClick={() => void remove(definition.id)}>Confirmar</button>
                    : <button type="button" className="nvu-senior-mini" data-tone="danger" aria-label={`Excluir ${definition.title}`} disabled={Boolean(busyId)} onClick={() => setConfirmId(definition.id)}><Trash2 size={15} aria-hidden="true" /></button>)}
                </div>
                <input ref={element => { inputs.current[definition.id] = element; }} type="file" accept="application/pdf,.pdf" hidden data-testid={`guide-file-${definition.id}`}
                  onChange={event => void pick(definition.id, event.target.files?.[0])} />
              </div>
            );
          })}
        </div>
        {confirmId && <p className="nvu-senior-note" role="status">Excluir remove o arquivo enviado. A página Manual passa a oferecer o guia que acompanha a versão instalada do app.</p>}
      </div>
    </ManagementDialog>
  );
}
