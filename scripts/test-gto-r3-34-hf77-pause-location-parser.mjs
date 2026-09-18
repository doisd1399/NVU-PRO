import { spawnSync } from "node:child_process";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const root = path.resolve(new URL("..", import.meta.url).pathname);
const read = (relative) => fs.readFileSync(path.join(root, relative), "utf8");
const service = read("android/app/src/main/java/com/nvu/operacional/GtoObserverService.java");
const parser = read("android/app/src/main/java/com/nvu/operacional/GtoPauseLocationParser.java");

assert.ok(parser.includes("extractAfterLastSeparator"), "parser Empresa -> Local existe");
assert.ok(parser.includes("'\\u2013'") && parser.includes("'\\u2014'"), "parser aceita en dash e em dash");
assert.ok(parser.includes("c == '-'"), "parser aceita hífen");
assert.ok(parser.includes("if (separator <= 0 || separator >= value.length() - 1) return \"\""), "sem separador/local vira pendente");
assert.ok(service.includes("pauseLocationTextField"), "OCR do pause usa parser de localização");
assert.ok(service.includes("pauseLocationTextField(lines, \"origem\""), "origem usa local final");
assert.ok(service.includes("pauseLocationTextField(lines, \"destino\""), "destino usa local final");
assert.ok(service.includes("pausePendingFieldsCsv"), "campos pendentes são explícitos");
assert.ok(service.includes("putString(\"pausePendingFields\""), "pendências são persistidas");
assert.ok(service.includes("pauseManualFallbackAllowed"), "manual continua bloqueado até fallback");
assert.ok(service.includes("maybeAnnouncePausePrompt"), "alerta pause permanece no pipeline");
assert.ok(service.includes("if (pauseRecoveryFlow)"), "ramo condicional de pendências permanece isolado");

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "nvu-hf77-parser-"));
try {
  const run = spawnSync(
    "java",
    [
      "scripts/java-tests/JavaTestRunner.java",
      tmp,
      "com.nvu.operacional.GtoPauseLocationParserTest",
      "android/app/src/main/java/com/nvu/operacional/GtoPauseLocationParser.java",
      "scripts/java-tests/com/nvu/operacional/GtoPauseLocationParserTest.java",
    ],
    { cwd: root, encoding: "utf8" },
  );
  const output = `${run.stdout || ""}\n${run.stderr || ""}`;
  assert.equal(run.status, 0, output);
  assert.match(output, /PASS GtoPauseLocationParser/);
} finally {
  fs.rmSync(tmp, { recursive: true, force: true });
}
console.log("PASS HF77: Empresa -> Local, pendência segura e fluxo condicional do pause verificados.");
