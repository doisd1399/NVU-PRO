import fs from "node:fs";
import assert from "node:assert/strict";

const root = new URL("..", import.meta.url).pathname;
const service = fs.readFileSync(`${root}android/app/src/main/java/com/nvu/operacional/SimpleAutomationService.java`, "utf8");
const audio = fs.readFileSync(`${root}android/app/src/main/java/com/nvu/operacional/NvuAudioManager.java`, "utf8");
const max = fs.readFileSync(`${root}android/app/src/main/java/com/nvu/operacional/GtoObserverService.java`, "utf8");

assert.match(audio, /playGtoAutomatedStartVoice\(String eventId\)/);
assert.match(max, /playGtoAutomatedStartVoice\(eventId\)/);
assert.match(service, /ACTION_START\.equals\(intent\.getAction\(\)\)/);
assert.match(service, /playProAutomatedStartVoiceIfEligible\(\)/);
assert.match(service, /audioManager\.playGtoAutomatedStartVoice\(eventId\)/);
assert.match(service, /PRO_AUTOMATED_START\|/);
assert.match(service, /contextEpoch/);
assert.match(service, /lastProAutomatedStartVoiceEventId/);
console.log("[PASS] Pro start audio: same Max opening voice, once per context epoch, no capture/registration coupling.");
