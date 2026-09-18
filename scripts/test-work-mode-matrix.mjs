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
assert(dialog.includes("Modo automático Max"), "rótulo do Max ausente");
assert(dialog.includes("Modo automático"), "rótulo do modo automático ausente");
assert(!dialog.includes("Modo automático simples"), "rótulo antigo automático simples ainda existe");
assert(dialog.includes("{isGto && ("), "Max não está restrito ao GTO");
assert(dialog.includes('onClick={() => void onSelect("simple")}'), "opção automática ausente");
assert(dialog.includes('onClick={() => void onSelect("max")}'), "opção Max ausente");
assert(!dialog.includes('GtoWorkMode = "print" | "automatic"'), "tipo antigo automático ainda existe");

for (const [name, source, simulatorExpr] of [
  ["Dashboard", dashboard, "variant={isGtoWork ? \"gto\" : \"simple\"}"],
  ["Profile", profile, "variant={isGtoWork ? \"gto\" : \"simple\"}"],
]) {
  assert(source.includes("Iniciar trabalho"), `${name} não usa o rótulo Iniciar trabalho`);
  assert(source.includes(simulatorExpr), `${name} não passa a variante ao diálogo`);
  assert(source.includes('mode === "simple"'), `${name} não trata o modo simples`);
  assert(source.includes('mode === "print"'), `${name} não trata o modo print`);
  assert(source.includes("startGtoAutomatic"), `${name} não preserva o handler Max/GTO`);
}

console.log("[work-mode-matrix] GTO=print/simple/Max; WTDS/WBDS/TOE3=print/simple: passed");
