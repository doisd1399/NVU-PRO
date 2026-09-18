import fs from 'node:fs';

const read = (path) => fs.readFileSync(path, 'utf8');
const sync = read('android/app/src/main/java/com/nvu/operacional/GtoAutoTripSync.java');
const service = read('android/app/src/main/java/com/nvu/operacional/GtoObserverService.java');
const plugin = read('android/app/src/main/java/com/nvu/operacional/GtoObserverPlugin.java');
const main = read('android/app/src/main/java/com/nvu/operacional/MainActivity.java');
const gradle = read('android/app/build.gradle');
const workflow = read('.github/workflows/build-android-release.yml');
const vite = read('vite.config.ts');

const checks=[];
const ck=(name,ok)=>{checks.push({name,ok:!!ok}); console.log(`${ok?'PASS':'FAIL'} ${name}`)};
const code = Number((gradle.match(/versionCode\s+(\d+)/) || [])[1] || 0);
const version = (gradle.match(/versionName\s+"([^"]+)"/) || [])[1] || "";
ck('HF54+ Android identity preserves upgrade baseline', code >= 106 && Number(version.split('.').at(-1) || 0) >= 106);
ck('HF54+ workflow identity follows Android identity', workflow.includes(`EXPECTED_VERSION_CODE: "${code}"`) && workflow.includes(`EXPECTED_VERSION_NAME: "${version}"`));
ck('Vite 6 invalid allowedHosts string removed', !vite.includes('allowedHosts: "all"'));
ck('upgrade recovery entrypoint exists', sync.includes('recoverLegacyPendingStateOnAuthenticatedStart'));
ck('MainActivity runs recovery before observer restoration', main.indexOf('recoverLegacyPendingStateOnAuthenticatedStart') >= 0 && main.indexOf('recoverLegacyPendingStateOnAuthenticatedStart') < main.indexOf('recoverIfEnabled'));
ck('observer startup repeats recovery after login', service.includes('repeat upgrade recovery when the native observer starts') && service.includes('GtoAutoTripSync.recoverLegacyPendingStateOnAuthenticatedStart(this, prefs);'));
ck('recovery schema is scoped per authenticated uid', sync.includes('gtoQueueRecoverySchemaUid') && sync.includes('!currentUid.equals(recoveredUid)'));
ck('legacy markers still reconcile against sealed queue', sync.includes('reconcileBackgroundSyncMarkers(context, mainPrefs)'));
ck('recovery never removes queue entries', !sync.slice(sync.indexOf('static void recoverLegacyPendingStateOnAuthenticatedStart'), sync.indexOf('/** True only when another sealed queue')).includes('queue.edit().remove'));
ck('old retry delay resets only once', sync.includes('gtoQueueRecoverySchema') && sync.includes('retryEditor.remove(RETRY_AT_PREFIX + sessionId)'));
ck('retry reset is scoped to authenticated owner', sync.includes('belongsToCurrentDriver') && sync.includes('currentUid.equals(payloadDriverId)'));
ck('foreign driver sealed queue is preserved', sync.includes('foreign++') && sync.includes('The sealed foreign queue itself is preserved intact'));
ck('background UI filters queue by current driver', service.includes('hasQueuedOtherThanForDriver(this, currentSessionId, summaryUid)'));
ck('plugin background diagnostic filters by current driver', plugin.includes('hasQueuedOtherThanForDriver(context, statusSessionId, statusUid)'));
ck('recovery persists queue count diagnostic', sync.includes('gtoQueueRecoveryQueueCount'));
ck('recovery persists owned queue diagnostic', sync.includes('gtoQueueRecoveryOwnedCount'));
ck('recovery persists foreign queue diagnostic', sync.includes('gtoQueueRecoveryForeignCount'));
ck('recovery persists invalid queue diagnostic', sync.includes('gtoQueueRecoveryInvalidCount'));
ck('recovery persists last error diagnostic', sync.includes('gtoQueueRecoveryLastErrorCode'));
ck('plugin exposes recovery summary', plugin.includes('gtoQueueRecoverySummary'));
ck('durable queue remains source of stale-marker truth', sync.includes('!hasPendingSession(context, markedSession)'));
ck('background ACK still clears sticky markers',
  sync.includes('lastIndependentDeliveryAckSessionId')
  && sync.includes('lastIndependentDeliveryAckTripId')
  && sync.includes('.remove("backgroundSyncPendingSessionId")')
  && sync.includes('.remove("backgroundSyncPendingDetail")')
  && sync.includes('.remove("backgroundSyncPendingAt")')
  && sync.includes('.remove("gtoPreviousQueuedSessionId")'));
ck('current trip still seals before next freight', service.indexOf('GtoAutoTripSync.enqueueConfirmedTrip(this, prefs, automaticTripSyncListener())') < service.indexOf('prepareNextFreightFromSealedQueue(completedSessionId)'));

const failed=checks.filter(c=>!c.ok);
console.log(`\n${checks.length-failed.length}/${checks.length} HF54 upgrade-recovery checks passed.`);
if(failed.length) process.exit(1);
