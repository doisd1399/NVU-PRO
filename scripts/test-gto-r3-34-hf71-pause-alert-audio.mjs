import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const root = path.resolve(new URL("..", import.meta.url).pathname);
const service = fs.readFileSync(path.join(root, "android/app/src/main/java/com/nvu/operacional/GtoObserverService.java"), "utf8");
const audio = fs.readFileSync(path.join(root, "android/app/src/main/java/com/nvu/operacional/NvuAudioManager.java"), "utf8");
const raw = path.join(root, "android/app/src/main/res/raw/nvu_pause_alert_voice_pt_br.mp3");

assert.ok(fs.statSync(raw).size > 1024, "MP3 do alerta deve existir e ter conteúdo");
assert.ok(audio.includes("PAUSE_ACTION"), "gerenciador deve ter categoria de áudio do pause");
assert.ok(audio.includes("playPauseActionVoice"), "gerenciador deve expor o áudio do alerta");
assert.ok(audio.includes("R.raw.nvu_pause_alert_voice_pt_br"), "gerenciador deve apontar para o MP3 fornecido");
assert.ok(audio.includes("KEY_LAST_PAUSE_EVENT_ID"), "áudio do pause deve ser deduplicado por evento");
assert.ok(audio.includes("pendingVoices"), "áudios devem usar fila serializada");
assert.ok(service.includes("boolean firstPromptEmission = !pausePromptVisible;"), "somente a primeira emissão deve tocar áudio");
assert.ok(service.includes("nvuAudioManager.playPauseActionVoice(audioEventId);"), "alerta deve disparar áudio nativo");
assert.ok(service.includes("PAUSE_ACTION_REQUIRED|"), "evento de áudio deve ser vinculado à sessão e ao disparo");
assert.ok(service.includes("Audio is fail-open and passive"), "falha de áudio não pode bloquear o fluxo");

console.log("PASS HF71: MP3 do pause integrado, serializado e reproduzido somente na primeira emissão do alerta.");
