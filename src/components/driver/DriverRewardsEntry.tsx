import React from "react";
import { Link } from "react-router-dom";
import { ChevronRight, Trophy } from "lucide-react";
import { useSessionStore } from "../../context/AppContext";
import { useDriverPayments, useDriverRewards } from "../../hooks/useRewards";
import { formatMoney } from "../../lib/partnerships";

/** Entrada das Recompensas no painel do motorista: só aparece quando há oferta nova ou campanha aceita. */
export function DriverRewardsEntry() {
  const { currentUser } = useSessionStore();
  const { offers } = useDriverRewards(currentUser?.id), { payments } = useDriverPayments(currentUser?.id), toConfirm = payments.filter(item => item.status === "paid").length;
  const now = Date.now(), pending = offers.filter(offer => offer.status === "pending" && offer.endMs >= now).length, accepted = offers.filter(offer => offer.status === "accepted" && offer.endMs >= now - 7 * 86_400_000);
  if (!pending && !accepted.length && !toConfirm) return null;
  const total = accepted.reduce((sum, offer) => sum + offer.totalCents, 0);
  return <Link to="/driver/recompensas" className="order-2 mb-3 flex items-center gap-3 rounded-2xl border border-[var(--nvu-line)] bg-[var(--nvu-surface,#fff)] px-4 py-3 text-left no-underline" data-testid="driver-rewards-entry">
    <Trophy size={22} aria-hidden="true" />
    <span className="flex-1 min-w-0"><strong className="block text-[14px]">Recompensas</strong><small className="block text-[12px] opacity-70">{toConfirm ? `${toConfirm} ${toConfirm === 1 ? "pagamento" : "pagamentos"} para confirmar` : pending ? `${pending} ${pending === 1 ? "oferta nova" : "ofertas novas"} para responder` : `Você já ganhou ${formatMoney(total)}`}</small></span>
    <ChevronRight size={18} aria-hidden="true" />
  </Link>;
}
