/**
 * Interactive callables that the backend serves from BOTH regions (see functions/src/callableRegions.ts).
 *
 * Firestore lives in São Paulo, so a callable running there answers in a fraction of the time the same code needs from
 * `us-central1`. The app calls São Paulo first and only falls back to `us-central1` when the São Paulo copy does not
 * exist yet (older deployment) — see regionalCallable.ts. Keep this list identical to the server's: the
 * `callable-regions` QA step compares both sides.
 */
export const CALLABLE_PRIMARY_REGION = "southamerica-east1";
export const CALLABLE_FALLBACK_REGION = "us-central1";

export const DUAL_REGION_CALLABLES: readonly string[] = [
  "operationalCommand",
  "prepareCompanyOperationalCommands",
  "getOperationalQueues",
  "configureOperationalQueues",
  "registerCanonicalSimpleTrip",
  "registerGtoProReceipt",
  "completeCanonicalOperation",
  "reconcileOperationTrips",
  "syncGtoTripState",
  "ensureCompanyAccess",
  "ensureRankingParticipantOperations",
  "manageFleetMembership",
  "manageCompanyGroup",
  "manageOperationalGoal",
  "updateWorkModeAvailability",
  "readPrivateUserProfiles",
  "authenticateSeniorAccess",
  "removeDriverFromFleetSenior",
  "suspendSeniorAccount",
  "reactivateSeniorAccount",
  "deleteSeniorProfile",
  "endSeniorOperationalSuspension",
  "reverseSeniorSuspension",
  "listSeniorSuspendedMembers",
  "approveDriverRequest",
  "rejectDriverRequest",
  "approveRecruitmentApplication",
  "rejectRecruitmentApplication",
  "repairApprovedMembership",
  "createPartnershipOffer",
  "respondPartnershipOffer",
  "cancelPartnershipOffer",
  "designatePartnershipDriver",
  "settlePartnershipPayment",
  "setPartnershipPix",
  "hidePartnership",
  "createRewardCampaign",
  "respondRewardOffer",
  "cancelRewardCampaign",
  "updateRewardCampaign",
  "hideRewardCampaign",
  "setRewardPayDay",
  "setRewardPix",
  "generateRewardPayroll",
  "markRewardPaid",
  "confirmRewardReceived",
  "contestRewardPayment",
  "cancelRewardPayment",
];

/** Callables that answer a `{ __warm: true }` ping before any authorization or database work. */
export const WARMABLE_CALLABLES: readonly string[] = [
  "operationalCommand",
  "registerCanonicalSimpleTrip",
  "completeCanonicalOperation",
  "reconcileOperationTrips",
  "ensureCompanyAccess",
];

const dual = new Set(DUAL_REGION_CALLABLES);
export const isDualRegionCallable = (name: string): boolean => dual.has(name);
