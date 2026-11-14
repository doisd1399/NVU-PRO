import fs from "node:fs";

const dashboard = fs.readFileSync("src/pages/driver/Dashboard.tsx", "utf8");
const dialog = fs.readFileSync("src/components/GtoWorkModeDialog.tsx", "utf8");
const profile = fs.readFileSync("src/pages/driver/Profile.tsx", "utf8");
const checks = [];
const check = (name, ok, detail = "") => {
  checks.push({ name, ok: Boolean(ok) });
  console.log(`${ok ? "PASS" : "FAIL"} ${name}${detail ? ` — ${detail}` : ""}`);
};

const paintStart = dashboard.indexOf("{paintDialogOpen && createPortal(");
const paintEnd = dashboard.indexOf("document.body", paintStart);
const paintBlock = paintStart >= 0 ? dashboard.slice(paintStart, paintEnd >= 0 ? paintEnd : undefined) : "";
const photoService = fs.readFileSync("src/services/vehiclePhotoService.ts", "utf8");
const photoStore = fs.readFileSync("src/services/vehiclePhotoStore.ts", "utf8");
const photoHook = fs.readFileSync("src/hooks/useVehiclePhoto.ts", "utf8");

check("modal de pinturas existe em um único portal", dashboard.split("createPortal(").length - 1 === 1 && paintBlock.includes("Pinturas disponíveis"));
check("botão de pinturas abre o mesmo estado do modal", dashboard.includes('onClick={() => setPaintDialogOpen(true)}') && dashboard.includes('paintDialogOpen && createPortal'));
check("overlay fecha e clique interno não propaga", paintBlock.includes('onClick={() => setPaintDialogOpen(false)}') && paintBlock.includes('onClick={e => e.stopPropagation()}'));
check("veículo e reboque exibem dados sem inventar valores", paintBlock.includes('vehicle?.paintCode') && paintBlock.includes('trailer?.paintCode') && paintBlock.includes('Nenhuma pintura disponibilizada'));
check("links https abrem e códigos usam cópia", paintBlock.includes('isLink') && paintBlock.includes('window.open') && paintBlock.includes('handleCopyPaintCode'));
check("cópia possui fallback para WebView", dashboard.includes('navigator.clipboard?.writeText') && dashboard.includes('document.execCommand("copy")'));
check("foto tem preview imediato e upload persistente", photoHook.includes('URL.createObjectURL(file)') && photoService.includes('uploadService.uploadImage') && photoService.includes('writeRemoteVehiclePhoto'));
check("foto tem persistência local e Firestore na reabertura", photoStore.includes('indexedDB.open') && photoStore.includes('imageDataUrl') && /useVehiclePhoto\([\s\S]{0,100}activeVehiclePhotoIdentity/.test(dashboard));
check("card e GTO recebem a mesma foto derivada", dashboard.includes('displayedVehiclePhoto ? <img') && dashboard.includes('vehiclePhoto={displayedVehiclePhoto}'));
check("perfil integrado compartilha foto entre seu modal e o Dashboard", profile.includes('vehiclePhoto={vehiclePhoto.src}') && profile.includes('vehiclePhotoOverride={vehiclePhoto}') && dashboard.includes('vehiclePhotoOverride || ownVehiclePhoto'));
check("GTO monta portal único com foto antes das opções", dialog.includes('return createPortal(') && dialog.includes('alt="Veículo atual"') && dialog.indexOf('alt="Veículo atual"') < dialog.indexOf('Modo print'));
check("GTO trata erro de carregamento sem quebrar o modal", dialog.includes('vehiclePhotoFailed') && dialog.includes('Não foi possível carregar a fotografia agora'));
check("temas claro/escuro preservados", dashboard.includes('dark:bg-[#303845]') && dashboard.includes('peer-checked:!bg-[#0cb49f]') && dialog.includes('dark:bg-[#15171c]'));

const failed = checks.filter(({ ok }) => !ok);
console.log(`\\n${checks.length - failed.length}/${checks.length} R3 modal/photo interaction checks passed.`);
if (failed.length) process.exit(1);
