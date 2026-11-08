/** When an idle-instance wake-up may be sent. Pure, so the cost rules are testable (see warmCallables.ts). */
export const WARM_INTERVAL_MS = 10 * 60_000;

export type WarmContext = { now: number; lastWarmAt: number; online: boolean; hidden: boolean; signedIn: boolean; tearingDown: boolean };

export const shouldWarm = (c: WarmContext): boolean =>
  c.online && !c.hidden && c.signedIn && !c.tearingDown && c.now - c.lastWarmAt >= WARM_INTERVAL_MS;
