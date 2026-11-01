import React, { useState } from "react";
import { Plus } from "lucide-react";
import { Button } from "../ui/Button";
import { ModalPortal } from "../ui/ModalPortal";
import { MultiOptionSelectionModal } from "../ui/MultiOptionSelectionModal";
import type { GroupSimulatorRow } from "../../services/companyGroupCore";

/**
 * "Simuladores da empresa" in the edit form: the simulators the company already has (one fleet each) and, for the owner,
 * the button that adds more. Adding asks for a confirmation that says what is created, then calls `onAdd`; the form
 * stays as it was if the server refuses.
 */
export function CompanySimulatorsSection({ rows, addable, canAdd, onAdd }: {
  rows: GroupSimulatorRow[];
  addable: Array<{ value: string; label: string }>;
  /** Only the owner, and only when the published server offers the command. */
  canAdd: boolean;
  onAdd: (simulatorIds: string[]) => Promise<string>;
}) {
  const [picking, setPicking] = useState(false);
  const [chosen, setChosen] = useState<string[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState("");
  const labels = (chosen || []).map(id => addable.find(option => option.value === id)?.label || id);
  const close = () => { if (!busy) { setChosen(null); setProblem(""); } };
  const confirm = async () => {
    if (!chosen || busy) return;
    setBusy(true); setProblem("");
    try { await onAdd(chosen); setChosen(null); }
    catch (error) { setProblem((error as Error)?.message || "Não foi possível adicionar agora."); }
    finally { setBusy(false); }
  };
  return <div data-testid="company-simulators">
    <span className="block text-[14px] font-medium text-slate-700 dark:text-nvu-muted mb-1.5 ml-1">Simuladores da empresa</span>
    <ul className="flex flex-col gap-2" aria-label="Simuladores da empresa">
      {rows.map(row => <li key={row.companyId} data-current={row.current || undefined}
        className="flex h-12 items-center justify-between rounded-xl border border-slate-200 bg-slate-50 px-3.5 text-[15px] font-bold text-slate-900 dark:border-nvu-line dark:bg-nvu-page dark:text-nvu-text">
        <span>{row.label}</span>
        <span className={`rounded-full border px-2.5 py-0.5 text-[11.5px] font-bold ${row.current
          ? "border-cyan-300 bg-cyan-50 text-cyan-700 dark:border-cyan-400/35 dark:bg-cyan-400/10 dark:text-cyan-300"
          : "border-emerald-300 bg-emerald-50 text-emerald-700 dark:border-emerald-400/30 dark:bg-emerald-400/10 dark:text-emerald-300"}`}>{row.current ? "Ambiente atual" : "Ativo"}</span>
      </li>)}
    </ul>
    {canAdd && addable.length > 0 && <button type="button" onClick={() => setPicking(true)}
      className="mt-2.5 flex h-12 w-full items-center justify-center gap-2 rounded-xl border-[1.5px] border-dashed border-blue-400/60 bg-blue-500/5 text-[14.5px] font-bold text-blue-700 dark:text-blue-300">
      <Plus size={18} strokeWidth={2.4} aria-hidden="true" />Adicionar simuladores
    </button>}
    <MultiOptionSelectionModal open={picking} title="Adicionar simuladores" description="Escolha os que a empresa vai passar a ter." options={addable.map(option => ({ value: option.value, label: option.label }))}
      values={[]} minSelected={1} onConfirm={values => setChosen(values)} onClose={() => setPicking(false)} />
    {chosen && <ModalPortal label="Adicionar simuladores" onClose={close} busy={busy}>
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm">
        <div className="nvu-viewport-modal-card relative flex w-full max-w-sm flex-col overflow-hidden rounded-3xl bg-white shadow-2xl dark:bg-nvu-surface">
          <div className="nvu-modal-body p-6">
            <h3 className="mb-3 text-xl font-bold tracking-tight text-slate-900 dark:text-white">Adicionar simuladores</h3>
            <p className="mb-2 text-[14px] text-slate-700 dark:text-nvu-text-soft">Adicionar à empresa:</p>
            <div className="mb-4 flex flex-wrap gap-2">{labels.map(label => <span key={label} className="inline-flex h-8 items-center rounded-[9px] border border-cyan-300 bg-cyan-50 px-3 text-[13px] font-bold text-cyan-700 dark:border-cyan-400/35 dark:bg-cyan-400/10 dark:text-cyan-300">{label}</span>)}</div>
            <ul className="flex flex-col gap-2.5 text-[13px] leading-relaxed text-slate-600 dark:text-nvu-muted">
              <li>Cada simulador ganha um ambiente próprio: frota, operações, motoristas e ranking separados.</li>
              <li>Nome, logo e proprietário são os mesmos. Você será administrador de todos.</li>
              <li>Os motoristas se inscrevem em cada simulador separadamente.</li>
            </ul>
            {problem && <p role="alert" className="mt-3 text-[12.5px] font-semibold text-rose-600 dark:text-rose-400">{problem}</p>}
          </div>
          <div className="flex gap-3 px-6 pb-6">
            <Button variant="outline" className="h-12 flex-1 rounded-xl border-slate-200 font-semibold text-slate-700 dark:border-nvu-line dark:text-nvu-text-soft" onClick={close} disabled={busy}>Cancelar</Button>
            <Button className="h-12 flex-1 rounded-xl border-0 bg-blue-600 font-semibold text-white hover:bg-blue-700" onClick={() => void confirm()} disabled={busy} aria-busy={busy}>
              {busy ? "Adicionando…" : `Adicionar ${chosen.length === 1 ? "1 simulador" : `${chosen.length} simuladores`}`}
            </Button>
          </div>
        </div>
      </div>
    </ModalPortal>}
  </div>;
}
