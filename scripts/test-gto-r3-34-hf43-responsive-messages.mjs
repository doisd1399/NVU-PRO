import fs from "node:fs";

const read = p => fs.readFileSync(p, "utf8");
const service = read("android/app/src/main/java/com/nvu/operacional/GtoObserverService.java");
const gradle = read("android/app/build.gradle");
const workflow = read(".github/workflows/build-android-release.yml");
const checks = [];
const ck = (name, ok) => { checks.push({name, ok: !!ok}); console.log(`${ok ? "PASS" : "FAIL"} ${name}`); };

const code = Number((gradle.match(/versionCode\s+(\d+)/) || [])[1] || 0);
const version = (gradle.match(/versionName\s+"([^"]+)"/) || [])[1] || "";
ck("HF43+ Android identity", code >= 95 && Number((version.match(/^1\.0\.(\d+)$/) || [])[1] || 0) >= 95);
ck("HF43+ workflow identity", workflow.includes(`EXPECTED_VERSION_CODE: "${code}"`) && workflow.includes(`EXPECTED_VERSION_NAME: "${version}"`));
ck("sticky driver stages can remain until a real lifecycle edge", service.includes("if (driverStage && durationMs <= 0L)") && service.includes("statusChipHideRunnable = null"));
ck("certified freight-list message is sticky while the list exists", service.includes('"FREIGHT_LIST_DETECTED"') && service.includes("freightListDetectedMessage") && service.includes("if (driverStage && durationMs <= 0L)"));
ck("freight-list close explicitly clears only the sticky list message", service.includes("clearStickyFreightListMessage();") && service.includes('if (!"FREIGHT_LIST_DETECTED".equals(code)) return;'));
ck("same list can announce again after a real close/reopen edge", service.includes('.remove("driverStageShownKey")') && service.includes('.putString("driverStageCode", "")'));
const touchLock = service.indexOf('persistSelectionIdentity(row, "TOUCH_LOCKED", transaction.source);');
const selectedMsg = service.indexOf('"FREIGHT_SELECTED"', touchLock);
const preciseOcr = service.indexOf('runPreciseSelectedRowOcr(transaction);', touchLock);
ck("freight-selected feedback is emitted before precise OCR", touchLock >= 0 && selectedMsg > touchLock && preciseOcr > selectedMsg);
ck("freight-selected message is truthful while data validation continues", service.includes('"Frete selecionado ✓ · confirmando dados…"'));
ck("confirmed trip stage is concise and does not wait on another message", service.includes('"Frete confirmado ✓ · viagem em andamento."'));
ck("certified result message is sticky while automatic registration is being sealed", service.includes('"AUTO_RESULT_SENDING"') && service.includes('"Viagem concluída, enviando dados automaticamente..."') && service.includes('"RESULT_DETECTED"'));
const latch = service.indexOf("private void latchExactReceiveAndSend");
const receiveMsg = service.indexOf('"RECEIVE_CONFIRMED"', latch);
const confirm = service.indexOf("confirmNormalResultAutomatically();", latch);
ck("exact Receive gives immediate visual acknowledgement before finalization", latch >= 0 && receiveMsg > latch && receiveMsg < confirm);
const autoFinalize = service.indexOf("private void confirmNormalResultAutomatically()");
const enqueue = service.indexOf("GtoTripSubmissionCoordinator.submitCompletedTrip", autoFinalize);
const sendingStage = service.indexOf('announceDriverStage(\n                "TRIP_SENDING"', autoFinalize);
const completionSendingStage = service.indexOf('"TRIP_SENDING"', 0);
ck("automatic completion exposes registering state before backend ACK",
  autoFinalize >= 0 && completionSendingStage >= 0 && enqueue > autoFinalize && sendingStage >= 0
    && service.includes('"Registrando viagem..."')
    && service.includes('stageKey.endsWith("|TRIP_SENDING")'));
ck("SENDING uses compact indeterminate loading and no success claim",
  service.includes('"TRIP_SENDING"')
  && service.includes('"Registrando viagem..."')
  && service.includes('progressView.setIndeterminate(true)')
  && service.includes('progressBarStyleSmall')
  && !service.includes('Viagem concluída ✓ · registro salvo; sincronizando em segundo plano.'));
const listener = service.indexOf("private GtoAutoTripSync.Listener automaticTripSyncListener()");
const menuSuccess = service.indexOf('completion.setText("Viagem registrada com sucesso!"');
const menuSyncGuard = service.lastIndexOf('if (GtoAutoTripSync.STATUS_SYNCED.equals(syncStatus))', menuSuccess);
const callbackSuccess = service.indexOf('"Viagem registrada com sucesso!"', listener);
ck("success wording is exposed only after a real SYNCED state/ACK", listener >= 0 && callbackSuccess > listener && menuSuccess >= 0 && menuSyncGuard >= 0 && menuSyncGuard < menuSuccess);
ck("normal happy-path status labels are concise",
  (service.includes('"Frete selecionado · confirmando dados"')
    || (service.includes('isManualRouteSelectionPending()') && service.includes('return "";')))
  && service.includes('return "Viagem concluída ✓ · enviando para o sistema";'));
ck("HF42 protected-result architecture remains present", service.includes("GtoResultProofStore.certify(") && service.includes("GtoResultProofStore.isProtectedPending"));
ck("completion remains independent from optional FPS/player HUD text", !service.includes('normalized.contains("fps")') && !service.includes('normalized.contains("desligado")'));

const failed = checks.filter(x => !x.ok);
console.log(`\n${checks.length - failed.length}/${checks.length} HF43 responsive-message checks passed.`);
if (failed.length) process.exit(1);
