import React, { memo } from "react";
import { StableImage } from "./common/StableImage";
import { rankingCompanyDisplayName, rankingDisplayName } from "../lib/rankingDisplayName";
import type { RankingPodiumItem } from "./RankingPremiumPodium";

interface Props {
  leader: Pick<RankingPodiumItem, "id" | "name" | "logo" | "trips">;
  viewerId?: string;
  assetType: "driver" | "company";
  periodLabel: string;
  earnings: string;
  comparison: string | null;
}

/** Compact presentation of the existing, currency-safe previous-period result. */
export const RankingPreviousPeriodCard = memo(function RankingPreviousPeriodCard({
  leader, viewerId, assetType, periodLabel, earnings, comparison,
}: Props) {
  const fullName = String(leader.name || "Líder anterior");
  const name = assetType === "company" ? rankingCompanyDisplayName(fullName) : rankingDisplayName(fullName);
  return (
    <section className="nvu-gamer-previous-leader" data-testid="ranking-previous-leader-card" aria-label="Líder do período anterior">
      <div className="nvu-gamer-previous-heading">
        <h2>Período concluído</h2>
        <span>{periodLabel}</span>
      </div>
      <div className="nvu-gamer-previous-body">
        <StableImage
          src={leader.logo} persistentViewerId={viewerId}
          persistentAssetId={`${assetType}:${leader.id}`} alt={fullName}
          loading="lazy" wrapperClassName="nvu-gamer-previous-photo"
          className={assetType === "company" ? "object-cover nvu-company-asset" : "object-cover"}
          fallback={<span>{name.slice(0, 2).toUpperCase()}</span>}
        />
        <div className="nvu-gamer-previous-person">
          <strong title={fullName}>{name}</strong>
          <small>1º · {earnings} · {Number(leader.trips || 0).toLocaleString("pt-BR")} viagens</small>
        </div>
        <div className="nvu-gamer-previous-delta">
          <span>Atual × anterior</span>
          {comparison ? <strong>{comparison}</strong> : <small>Diferença indisponível: moedas ou dados não comparáveis.</small>}
        </div>
      </div>
    </section>
  );
});
