import React, { useId } from "react";

export function rankingMetal(rank: number) {
  return rank === 1 ? "gold" : rank === 2 ? "silver" : rank === 3 ? "bronze" : "neutral";
}

/** Local vectors follow the live theme; participant data is never baked into art. */
export function GamerRankBadge({ rank, row = false }: { rank: number; row?: boolean }) {
  const id = useId().replace(/:/g, "");
  return (
    <span className={`nvu-gamer-rank nvu-metal-${rankingMetal(rank)}${row ? " nvu-gamer-rank-row" : ""}`} aria-hidden="true">
      <svg viewBox="0 0 120 42" preserveAspectRatio="none" focusable="false">
        <defs><linearGradient id={`rim-${id}`} x2="0" y2="1">
          <stop stopColor="var(--rank-highlight)" />
          <stop offset=".5" stopColor="var(--rank-metal)" />
          <stop offset="1" stopColor="var(--rank-lowlight)" />
        </linearGradient></defs>
        <path d="M6 2H114L118 6V36L114 40H6L2 36V6Z" fill="var(--gamer-panel)" stroke={`url(#rim-${id})`} strokeWidth="3" />
        <path d="M8 5H112L115 8V34L112 37H8L5 34V8Z" fill="none" stroke="var(--rank-metal)" strokeWidth=".6" />
        <path d="M8 11V8H13M107 8H112V11M8 31V34H13M107 34H112V31" fill="none" stroke="var(--rank-metal)" strokeWidth="1.2" />
      </svg>
      <span className="nvu-gamer-rank-label">
        {rank === 1 && !row && <GamerCrown />}
        {row ? String(rank).padStart(2, "0") : <span className="nvu-gamer-ordinal">{rank}<sup>º</sup></span>}
      </span>
    </span>
  );
}

export function GamerCrown() {
  return <svg className="nvu-gamer-crown" viewBox="0 0 24 24" fill="none" aria-hidden="true" focusable="false">
    <path d="M3 6l5 4 4-7 4 7 5-4-2 12H5L3 6Z" fill="var(--rank-metal, #b98620)" stroke="var(--rank-lowlight, #8a5c12)" strokeLinejoin="round" />
    <path d="M6 20h12M5 16h14" stroke="var(--rank-highlight, #f5db9d)" strokeLinecap="round" />
  </svg>;
}

export function GamerFrame() {
  return <svg className="nvu-gamer-frame" viewBox="0 0 200 260" preserveAspectRatio="none" aria-hidden="true" focusable="false">
    <path d="M16 2H184L198 16V244L184 258H16L2 244V16Z" fill="none" stroke="var(--rank-metal)" strokeWidth="2.4" />
    <path d="M19 7H181L193 19V241L181 253H19L7 241V19Z" fill="none" stroke="var(--gamer-border)" strokeWidth="1" />
    <path d="M17 3H40M160 3H183M3 17V38M197 222V243M17 257H40M160 257H183" fill="none" stroke="var(--rank-highlight)" strokeWidth="2" />
    <path d="M4 15L16 3M184 257L197 244" fill="none" stroke="var(--gamer-accent)" strokeWidth="3" />
  </svg>;
}

export function GamerRouteIcon({ className = "" }: { className?: string }) {
  return <svg className={`nvu-gamer-route ${className}`} viewBox="0 0 24 24" fill="none" aria-hidden="true" focusable="false">
    <path d="M21 3 15.8 21 11.1 12.9 3 8.2 21 3Z" fill="var(--gamer-accent-bright, #09bad4)" stroke="var(--gamer-accent-bright, #09bad4)" strokeLinejoin="round" />
    <path d="m11.1 12.9 9.9-9.9-5.2 18-4.7-8.1Z" fill="var(--gamer-accent, #0085a1)" />
    <path d="m3 8.2 18-5.2-9.9 9.9L3 8.2Z" fill="currentColor" opacity=".45" />
  </svg>;
}
