import React, { memo, useId } from "react";
import { StableImage } from "./common/StableImage";
import { GamerCrown, rankingMetal } from "./RankingGamerDecor";
import { rankingCompanyDisplayName, rankingDisplayName } from "../lib/rankingDisplayName";
import "./RankingPremiumPodium.css";

export interface RankingPodiumItem {
  id: string;
  name: string;
  logo?: string;
  trips: number;
  [key: string]: unknown;
}
interface RankingPremiumPodiumProps {
  items: RankingPodiumItem[];
  viewerId?: string;
  assetType: "driver" | "company";
  formatCurrency: (item: RankingPodiumItem) => string;
  onOpen: (item: RankingPodiumItem, rank: number) => void;
}
const slots = [
  { rank: 2, index: 1 },
  { rank: 1, index: 0 },
  { rank: 3, index: 2 },
] as const;

/** One sculpted silhouette for every place, including the raised number seat. */
function PodiumPlinth() {
  const id = useId().replace(/:/g, "");
  return <span className="nvu-podium-plinth" aria-hidden="true">
    <svg viewBox="0 0 200 100" preserveAspectRatio="none" focusable="false">
      <defs>
        <linearGradient id={`${id}-front`} x1="0" x2="1">
          <stop offset="0" stopColor="var(--podium-edge)" />
          <stop offset=".16" stopColor="var(--podium-front)" />
          <stop offset=".5" stopColor="var(--podium-center)" />
          <stop offset=".84" stopColor="var(--podium-front)" />
          <stop offset="1" stopColor="var(--podium-edge)" />
        </linearGradient>
        <linearGradient id={`${id}-deck`} x2="0" y2="1">
          <stop stopColor="var(--podium-deck)" />
          <stop offset="1" stopColor="var(--podium-edge)" />
        </linearGradient>
      </defs>
      <ellipse cx="100" cy="21" rx="99" ry="20" fill={`url(#${id}-deck)`} />
      <path className="nvu-podium-front" d="M1 21 C1 34 23 43 44 43 C61 43 61 25 79 24 Q100 21 121 24 C139 25 139 43 156 43 C177 43 199 34 199 21 L199 78 Q199 98 165 98 L35 98 Q1 98 1 78 Z" fill={`url(#${id}-front)`} />
      <path d="M2 24 C5 36 25 43 44 43 C61 43 61 25 79 24 Q100 21 121 24 C139 25 139 43 156 43 C175 43 195 36 198 24" fill="none" stroke="var(--podium-rim)" strokeWidth="1.2" />
    </svg>
  </span>;
}

/** Theme-aware sculpted bases and live participant images, with no winner outline. */
const RankingPremiumPodium = memo(function RankingPremiumPodium({
  items, viewerId, assetType, formatCurrency, onOpen,
}: RankingPremiumPodiumProps) {
  return (
    <div className="nvu-premium-podium" data-testid="ranking-premium-podium" role="group" aria-label="Pódio do ranking">
      <div className="nvu-podium-scene">
        {slots.map(({ rank, index }) => {
          const item = items[index];
          const fullName = String(item?.name || "");
          const name = assetType === "company" ? rankingCompanyDisplayName(fullName) : rankingDisplayName(fullName);
          return (
            <div key={rank} className={`nvu-podium-slot nvu-podium-${rankingMetal(rank)} nvu-metal-${rankingMetal(rank)}`}>
              <button
                type="button"
                className="nvu-podium-participant"
                data-testid={`podium-place-${rank}`}
                data-participant-id={item?.id}
                disabled={!item || assetType === "company"}
                aria-label={item ? `${rank}º lugar: ${fullName}, ${formatCurrency(item)}, ${item.trips} viagens${assetType === "company" ? "." : ". Ver perfil."}` : `${rank}º lugar: sem classificação`}
                onClick={() => item && onOpen(item, rank)}
              >
                <PodiumPlinth />
                {rank === 1 && item && <span className="nvu-podium-crown"><GamerCrown /></span>}
                {item ? <>
                  <span className="nvu-podium-portrait-shell">
                  <StableImage
                    src={item.logo}
                    persistentViewerId={viewerId}
                    persistentAssetId={`${assetType}:${item.id}`}
                    alt={fullName}
                    loading="eager"
                    decoding="async"
                    fetchPriority="high"
                    preload
                    hideFallbackWhenCached
                    hideFallbackWhileLoading
                    wrapperClassName="nvu-podium-photo"
                    className={assetType === "company" ? "object-cover nvu-company-asset" : "object-cover"}
                    fallback={<span className="nvu-podium-initials">{name.substring(0, 2).toUpperCase() || "NV"}</span>}
                  />
                  </span>
                  <span className="nvu-podium-place" aria-hidden="true">{rank}<sup>º</sup></span>
                  <span className="nvu-podium-name" title={fullName}>{name}</span>
                </> : <>
                  <span className="nvu-podium-portrait-shell"><span className="nvu-podium-photo nvu-podium-vacancy-photo" aria-hidden="true">—</span></span>
                  <span className="nvu-podium-place" aria-hidden="true">{rank}<sup>º</sup></span>
                  <span className="nvu-podium-name nvu-podium-vacancy">Sem classificação</span>
                </>}
              </button>
            </div>
          );
        })}
      </div>
    </div>
  );
});
export default RankingPremiumPodium;
