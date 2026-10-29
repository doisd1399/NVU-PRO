export function needsSessionReconnect(input: {
  manual: boolean; uid?: string | null; profileUid?: string | null;
  userListenerConnected: boolean; membershipListenerConnected: boolean; membershipConfirmed: boolean;
}): boolean {
  if (!input.uid) return false;
  return input.manual || input.uid !== input.profileUid || !input.userListenerConnected ||
    !input.membershipListenerConnected || !input.membershipConfirmed;
}

/** Reconnecting an observer does not create a new authenticated account. */
export function nextSessionGeneration(previousUid: string | null, nextUid: string | null, generation: number): number {
  return nextUid && nextUid === previousUid && generation > 0 ? generation : generation + 1;
}
