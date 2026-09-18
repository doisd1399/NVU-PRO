export type ReauthMembershipSnapshot<T> = {
  uid: string;
  memberships: T[];
};

export type ReauthMembershipDecision<T> = {
  memberships: T[];
  sameUid: boolean;
  shouldClearPrevious: boolean;
};

export function resolveReauthMemberships<T>(
  snapshot: ReauthMembershipSnapshot<T> | null,
  authenticatedUid: string,
): ReauthMembershipDecision<T> {
  if (!snapshot) {
    return { memberships: [], sameUid: false, shouldClearPrevious: false };
  }
  if (snapshot.uid === authenticatedUid) {
    return {
      memberships: snapshot.memberships,
      sameUid: true,
      shouldClearPrevious: false,
    };
  }
  return { memberships: [], sameUid: false, shouldClearPrevious: true };
}
