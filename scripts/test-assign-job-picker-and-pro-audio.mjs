import assert from "node:assert/strict";
import fs from "node:fs";

const read = (relativePath) => fs.readFileSync(new URL(`../${relativePath}`, import.meta.url), "utf8");
const assignJob = read("src/pages/admin/AssignJob.tsx");
const picker = read("src/components/admin/AssignJobAssetPicker.tsx");
const service = read("android/app/src/main/java/com/nvu/operacional/SimpleAutomationService.java");
const audio = read("android/app/src/main/java/com/nvu/operacional/NvuAudioManager.java");

assert.match(assignJob, /AssignJobAssetPicker/);
assert.match(assignJob, /isContractPickerOpen/);
assert.match(assignJob, /isVehiclePickerOpen/);
assert.match(assignJob, /selectedContractData\?\.trailerId/);
assert.match(assignJob, /selectedTrailerData\?\.name/);
assert.match(assignJob, /sequences=\{sequences\}/);
assert.doesNotMatch(assignJob, /\[selectedTrailer, setSelectedTrailer\]/);
assert.doesNotMatch(assignJob, /Reboque Vinculado[\s\S]{0,600}<select/);
assert.doesNotMatch(assignJob, /availableTrailers/);

assert.match(picker, /type PickerKind = "contract" \| "vehicle"/);
assert.match(picker, /Selecionar operação/);
assert.match(picker, /Selecionar veículo/);
assert.match(picker, /Em uso por/);
assert.match(picker, /totalDeliveries/);
assert.match(picker, /trailer\?\.name/);
assert.match(picker, /sequenceId\?\: string \| null/);
assert.match(picker, /contractGroups/);
assert.match(picker, /contract\.sequenceId === sequence\.id/);
assert.match(picker, /name: "Sem pasta"/);
assert.match(picker, /collapsedFolders/);
assert.match(picker, /FolderOpen/);

const nativeCitySelection = service.slice(service.indexOf("private void addCityPicker"), service.indexOf("private List<String> readCities"));
assert.match(nativeCitySelection, /putString\("destination", city\)/);
assert.match(nativeCitySelection, /emitSimpleReadyVoice\(tripStartedAt\)/);
assert.match(nativeCitySelection, /Tudo preparado, podemos partir/);
assert.match(audio, /playReadyVoice\(String eventId\)/);
assert.match(audio, /nvu_ready_voice_pt_br/);

console.log("assign-job-picker-and-pro-audio: PASS cards, derived trailer and Pro READY voice");
