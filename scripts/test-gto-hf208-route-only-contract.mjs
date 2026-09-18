import fs from 'node:fs';

const servicePath = 'android/app/src/main/java/com/nvu/operacional/GtoObserverService.java';
const certifiedPath = 'android/app/src/main/java/com/nvu/operacional/GtoCertifiedFreight.java';
const reviewPolicyPath = 'android/app/src/main/java/com/nvu/operacional/GtoFreightReviewEligibilityPolicy.java';
const service = fs.readFileSync(servicePath, 'utf8');
const certified = fs.readFileSync(certifiedPath, 'utf8');
const reviewPolicy = fs.readFileSync(reviewPolicyPath, 'utf8');

const checks = [];
function check(name, condition) {
  checks.push({ name, condition: Boolean(condition) });
}

const begin = service.indexOf('private void beginManualRouteSelection(');
const beginEnd = service.indexOf('\n    private void applyManualRouteSelection(', begin);
const beginBody = service.slice(begin, beginEnd);
const first = service.indexOf('private String firstReviewField(');
const firstEnd = service.indexOf('\n    private boolean isManualRouteContractEnabled(', first);
const firstBody = service.slice(first, firstEnd);
const pause = service.indexOf('private boolean isPauseRecoveryEligible()');
const pauseEnd = service.indexOf('\n    private boolean hasUnsafeSelectedFreightForPauseRecovery()', pause);
const pauseBody = service.slice(pause, pauseEnd);
const normalize = service.indexOf('private boolean normalizeLegacyReviewToManualRoute()');
const normalizeEnd = service.indexOf('\n    private boolean isManualRouteSelectionPending()', normalize);
const normalizeBody = service.slice(normalize, normalizeEnd);
const refresh = service.indexOf('private void refreshMenuContents()');
const refreshEnd = service.indexOf('\n    /**\n     * Restored', refresh);
const refreshBody = service.slice(refresh, refreshEnd);
const apply = service.indexOf('private void applyManualFreightReviewField(');
const applyEnd = service.indexOf('\n    private void styleManualRouteOption(', apply);
const applyBody = service.slice(apply, applyEnd);

check('manual route clears cargo and starts at origin',
  begin >= 0 && beginBody.includes('draft.cargo = "";') && beginBody.includes('MANUAL_ROUTE_ORIGIN'));
check('manual route keeps km/value from selected row',
  beginBody.includes('draft.km = canonicalKm(draft.km)') && beginBody.includes('draft.offeredValue = canonicalMoney(draft.offeredValue)'));
check('firstReviewField never returns cargo/distance/value under new contract',
  firstBody.indexOf('if (isManualRouteContractEnabled())') >= 0
    && firstBody.indexOf('if (isManualRouteContractEnabled())') < firstBody.indexOf('GtoFreightReviewPolicy.DISTANCE'));
check('pause recovery is disabled under route-only contract',
  pauseBody.includes('if (isManualRouteContractEnabled()) return false;'));
check('legacy review normalizes into manual route',
  normalizeBody.includes('pendingFreightReview') && normalizeBody.includes('beginManualRouteSelection'));
check('menu normalizes before rendering signature',
  refreshBody.includes('normalizeLegacyReviewToManualRoute();')
    && refreshBody.indexOf('normalizeLegacyReviewToManualRoute();') < refreshBody.indexOf('String nextSignature'));
check('legacy field input is blocked in route-only contract',
  applyBody.includes('if (isManualRouteContractEnabled())')
    && applyBody.includes('Selecione somente a origem e o destino da rota.'));
check('manual certification bypasses city canonicalization',
  certified.includes('boolean manualRouteSelection = sealed.optBoolean("manualRouteSelectionConfirmed", false);')
    && certified.includes('if (!manualRouteSelection)'));
check('review eligibility is no longer reachable from manual route entry',
  service.indexOf('if (isManualRouteContractEnabled()) {\n            beginManualRouteSelection') >= 0);
check('cargo policy remains compatibility-only, not a new UI contract',
  reviewPolicy.includes('automaticFieldCount') && service.includes('isManualRouteContractEnabled()'));

const failed = checks.filter((item) => !item.condition);
for (const item of checks) console.log(`${item.condition ? 'PASS' : 'FAIL'} ${item.name}`);
if (failed.length) process.exit(1);
console.log(`ROUTE_ONLY_CONTRACT ${checks.length}/${checks.length}`);
