import { createPortal } from "react-dom";
import React, { useMemo, useState } from "react";
import { toast } from "sonner";
import { Wallet, X } from "lucide-react";
import { useDriverPayments, useDriverRewards } from "../../hooks/useRewards";
import { rewardService } from "../../services/rewardService";
import { formatMoney } from "../../lib/partnerships";
import { rewardErrorMessage, type RewardOffer } from "../../lib/rewards";
import { DriverPixCard } from "../rewards/PaymentParts";
import "./PartnershipStartSheet.css";

const KEY = "nvu-reward-completion-seen";
const seenIds = (): string[] => { try { const parsed = JSON.parse(window.localStorage.getItem(KEY) || "[]"); return Array.isArray(parsed) ? parsed.map(String) : []; } catch { return []; } };
const markSeen = (id: string) => { try { window.localStorage.setItem(KEY, JSON.stringify([...new Set([...seenIds(), id])].slice(-60))); } catch { /* sem armazenamento: aparece de novo na próxima abertura */ } };

/**
 * Ao concluir uma operação com pagamento: no prazo, o motorista confirma/informa a chave Pix que a empresa vai usar;
 * fora do prazo, ele é avisado de que finalizou mas não recebe. Cada operação aparece uma vez.
 */
export function RewardCompletionPrompt({ driverId }: { driverId: string | undefined }) {
  const { offers } = useDriverRewards(driverId), { pix, ready } = useDriverPayments(driverId);
  const [dismissed, setDismissed] = useState<string[]>([]), [busy, setBusy] = useState(false);
  const target: RewardOffer | undefined = useMemo(() => {
    if (!ready) return undefined;
    const seen = new Set([...seenIds(), ...dismissed]), recent = Date.now() - 14 * 86_400_000;
    return offers.find(offer => offer.status === "accepted" && !seen.has(offer.id) && ((offer.completedAtMs > recent && !offer.expired && !offer.goalMissed) || (offer.expired && offer.expiredAtMs > recent) || (offer.goalMissed && offer.completedAtMs > recent)));
  }, [offers, ready, dismissed]);
  if (!driverId || !target) return null;
  const close = () => { markSeen(target.id); setDismissed(list => [...list, target.id]); };
  const lost = target.expired || target.goalMissed;
  return createPortal(<div className="nvu-pss-backdrop" role="presentation" onClick={() => !busy && close()}>
    <section className="nvu-pss" role="dialog" aria-modal="true" aria-labelledby="nvu-rcp-title" onClick={event => event.stopPropagation()} data-testid="reward-completion-prompt">
      <header><span className="nvu-pss-badge"><Wallet size={14} aria-hidden="true" /> Carteira</span><button type="button" aria-label="Fechar" disabled={busy} onClick={close}><X size={18} aria-hidden="true" /></button></header>
      <h2 id="nvu-rcp-title">{target.goalMissed ? "Meta não atingida" : lost ? "Prazo encerrado" : "Operação concluída"}</h2>
      <p className="nvu-pss-partner">{target.contractName || target.name} · {target.companyName}</p>
      {target.goalMissed
        ? <p className="nvu-pss-notice" role="alert">Você concluiu a operação, mas os ganhos das viagens ficaram abaixo da meta{target.goalCents ? ` de ${formatMoney(target.goalCents)}` : ""}. Sem a meta, você <b>não recebe</b> {target.lostCents ? `os ${formatMoney(target.lostCents)} ` : ""}pelo trabalho.</p>
        : lost
        ? <p className="nvu-pss-notice" role="alert">Você finalizou fora do prazo. O trabalho foi concluído, mas você <b>não recebe</b> {target.lostCents ? `os ${formatMoney(target.lostCents)} ` : ""}pelo serviço, por romper o acordo.</p>
        : <>
          <p className="nvu-pss-notice" role="note">Você concluiu no prazo e vai receber <b>{formatMoney(target.totalCents)}</b>. Confirme a chave Pix para a empresa pagar.</p>
          <DriverPixCard pix={pix} busy={busy} onSave={async (type, key) => { setBusy(true); try { await rewardService.setPix(type, key); toast.success("Chave Pix salva."); } catch (reason) { toast.error(rewardErrorMessage(reason, "Não foi possível salvar a chave Pix.")); throw reason; } finally { setBusy(false); } }} />
        </>}
      <button type="button" className="nvu-pss-start" disabled={busy || (!lost && !pix)} onClick={close}>{lost ? "Entendi" : pix ? "Usar esta chave" : "Cadastre a chave para continuar"}</button>
    </section>
  </div>, document.body);
}
