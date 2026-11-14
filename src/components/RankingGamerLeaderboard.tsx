import React, { memo } from "react";
import { BarChart3 } from "lucide-react";
import { StableImage } from "./common/StableImage";
import { GamerCrown, GamerRouteIcon, rankingMetal } from "./RankingGamerDecor";
import { rankingCompanyDisplayName, rankingDisplayName } from "../lib/rankingDisplayName";
import { ChevronRight, ChevronUp } from "lucide-react";
import "./RankingGamer.css";

interface Props {
  items: any[];
  viewerId?: string;
  assetType: "driver" | "company";
  showPhotos: boolean;
  criticalLimit: number;
  formatCurrency: (item: any) => string;
  onOpen: (item: any, rank: number) => void;
  additionalCount?: number;
  participantCount?: number;
  showAdditionalParticipants?: boolean;
  onToggleAdditional?: () => void;
}

function Money({ value }: { value: string }) {
  return <span className="nvu-gamer-money">{value.split(/\s*·\s*/).map((group, index) => <span key={index}>{group}</span>)}</span>;
}

interface RowProps {
  item: any;
  rank: number;
  critical: boolean;
  viewerId?: string;
  assetType: "driver" | "company";
  showPhoto: boolean;
  money: string;
  onOpen: (item: any, rank: number) => void;
}

/** Unchanged participants retain their image instances on unrelated page updates. */
const RankingGamerRow = memo(function RankingGamerRow({ item, rank, critical, viewerId, assetType, showPhoto, money, onOpen }: RowProps) {
  const fullName = String(item.name || "Participante");
  const name = assetType === "company" ? rankingCompanyDisplayName(fullName) : rankingDisplayName(fullName);
  return (
    <li className={`nvu-gamer-row-wrap nvu-metal-${rankingMetal(rank)}`}>
      <button type="button" data-testid={`ranking-row-${rank}`} data-participant-id={item.id}
        className={`nvu-gamer-row${rank === 1 ? " nvu-gamer-leader" : ""}${showPhoto ? " nvu-gamer-row-with-photo" : ""}`}
        style={rank > 3 ? { contentVisibility: "auto", containIntrinsicSize: "80px" } : undefined}
        aria-label={`${rank}º lugar: ${fullName}, ${money}, ${item.trips} viagens${assetType === "company" ? "." : ". Ver perfil."}`}
        disabled={assetType === "company"}
        onClick={() => { if (assetType !== "company") onOpen(item, rank); }}>
        <span className="nvu-gamer-row-person">
          <span className="nvu-gamer-row-position" aria-hidden="true">{String(rank).padStart(2, "0")}</span>
          {showPhoto && <StableImage src={item.logo} persistentViewerId={viewerId} persistentAssetId={`${assetType}:${item.id}`} alt="" loading={critical ? "eager" : "lazy"} decoding="async" fetchPriority={critical ? "high" : "low"} preload={critical} hideFallbackWhenCached hideFallbackWhileLoading wrapperClassName="nvu-gamer-row-photo" className={assetType === "company" ? "object-cover nvu-company-asset" : "object-cover"} fallback={<span>{name.slice(0,2).toUpperCase()}</span>} />}
          <span className="nvu-gamer-row-identity">
            {rank === 1 && <span className="nvu-gamer-leader-label"><GamerCrown />LÍDER</span>}
            <span className="nvu-gamer-row-name" title={fullName}>{name}</span>
          </span>
        </span>
        <span className="nvu-gamer-row-results">
          <Money value={money} />
          <span className="nvu-gamer-trips"><GamerRouteIcon /><span>{Number(item.trips || 0).toLocaleString("pt-BR")} viagens</span></span>
        </span>
      </button>
    </li>
  );
});

export const RankingGamerLeaderboard = memo(function RankingGamerLeaderboard({
  items, viewerId, assetType, showPhotos, criticalLimit, formatCurrency, onOpen,
  additionalCount = 0, showAdditionalParticipants = false,
  participantCount = items.length + (showAdditionalParticipants ? 0 : additionalCount), onToggleAdditional,
}: Props) {
  return (
    <section className="nvu-gamer-leaderboard" aria-label="Classificação por ganhos">
      <div className="nvu-gamer-section-heading">
        <h2 className="nvu-gamer-section-title"><BarChart3 size={19} aria-hidden="true" />Classificação</h2>
        <span className="nvu-gamer-participant-count">{participantCount.toLocaleString("pt-BR")} {assetType === "company" ? participantCount === 1 ? "empresa" : "empresas" : participantCount === 1 ? "motorista" : "motoristas"}</span>
      </div>
      <ol className="nvu-gamer-rows" id="ranking-gamer-rows">
        {items.map((item, index) => <RankingGamerRow key={item.id} item={item} rank={index + 1}
          critical={index < criticalLimit} viewerId={viewerId} assetType={assetType}
          showPhoto={showPhotos} money={formatCurrency(item)} onOpen={onOpen} />)}
      </ol>
      {additionalCount > 0 && onToggleAdditional && (
        <button type="button" className="nvu-gamer-more nvu-gamer-more-inline"
          aria-controls="ranking-gamer-rows" aria-expanded={showAdditionalParticipants}
          aria-label={showAdditionalParticipants ? "Recolher participantes" : "Ver demais participantes"}
          onClick={onToggleAdditional}>
          <span>{showAdditionalParticipants ? "Recolher participantes" : "Ver demais participantes"}
            <small>{showAdditionalParticipants ? "Somente o Top 3" : `${additionalCount} a partir do 4º lugar`}</small>
          </span>
          {showAdditionalParticipants ? <ChevronUp size={17} /> : <ChevronRight size={17} />}
        </button>
      )}
    </section>
  );
});
