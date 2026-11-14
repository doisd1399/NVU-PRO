import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");
const assert = (condition, message) => {
  if (!condition) throw new Error(`[work-mode-matrix] ${message}`);
};

const dialog = read("src/components/GtoWorkModeDialog.tsx");
const dashboard = read("src/pages/driver/Dashboard.tsx");
const profile = read("src/pages/driver/Profile.tsx");

assert(dialog.includes('export type GtoWorkMode = "print" | "simple" | "max";'), "união de modos não contém print/simple/max");
assert(dialog.includes('type WorkModeDialogVariant = "gto" | "simple";'), "variante GTO/simple ausente");
assert(dialog.includes('const isGto = variant === "gto";'), "diálogo não distingue GTO dos simuladores simples");
assert(dialog.includes("Modo automático Max"), "implementação do Max ausente");
assert(dialog.includes("showMaxMode = false"), "card do Max deve permanecer oculto no seletor padrão");
assert(dialog.includes("Modo automático"), "rótulo do modo automático ausente");
assert(!dialog.includes("Modo automático simples"), "rótulo antigo automático simples ainda existe");
assert(dialog.includes("{isGto && (") || dialog.includes("{isGto && showMaxMode && ("), "Max não está restrito ao GTO");
assert(!dialog.includes('onSelect(isGto ? "max" : "simple")'), "Pro GTO não pode ser roteado como Max");
assert(dialog.includes('await onSelect("simple")'), "bolha temporária não inicia o Pro");
assert(dialog.includes('if (overlayReady) void onSelect("simple")'), "bolha permanente não inicia o Pro");
assert(dialog.includes('(await SimpleAutomation.getStatus()).running'), "bolha temporária não confirma o serviço Pro");
assert(dialog.includes('onClick={() => void onSelect("max")}'), "opção Max ausente");
assert(!dialog.includes('GtoWorkMode = "print" | "automatic"'), "tipo antigo automático ainda existe");

for (const [name, source, simulatorExpr] of [
  ["Dashboard", dashboard, "variant={isGtoWork ? \"gto\" : \"simple\"}"],
  ["Profile", profile, "variant={isGtoWork ? \"gto\" : \"simple\"}"],
]) {
  assert(source.includes("Iniciar trabalho"), `${name} não usa o rótulo Iniciar trabalho`);
  assert(source.includes(simulatorExpr), `${name} não passa a variante ao diálogo`);
  assert(source.includes('mode === "simple"'), `${name} não trata o modo simples`);
  assert(source.includes('mode === "simple" ? "pro" : "max"'), `${name} não associa Pro ao controle Pro`);
  assert(source.includes('if (mode === "simple") {\n      await startSimpleAutomation(entryCheck);'), `${name} não inicia o serviço Pro`);
  assert(source.includes('isGtoWork\n        ? getSimpleAutomationSimulator("GTO")'), `${name} pode abrir Pro GTO sem resolver o serviço Pro`);
  assert(source.includes('mode === "print"'), `${name} não trata o modo print`);
  assert(source.includes("startGtoAutomatic"), `${name} não preserva o handler Max/GTO`);
}

console.log("[work-mode-matrix] GTO Pro usa serviço e controle Pro; Max permanece separado: passed");
