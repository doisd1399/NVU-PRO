import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { build } from "esbuild";

// The Atividade list shows the value and the send status of each trip; the simulator is not repeated on every row.
// Built inside the project (ignored folder) so react and the other packages resolve from node_modules.
const dir = path.resolve("verification/operation-info", `.activity-row-${process.pid}`);
await fs.mkdir(dir, { recursive: true });
const entry = path.join(dir, "entry.tsx");
await fs.writeFile(entry, `import React from "react"; import { renderToStaticMarkup } from "react-dom/server";
import { DriverActivityRow } from ${JSON.stringify(path.resolve("src/components/driver/DriverActivityRow.tsx"))};
const trip = { id: "t1", contratoNome: "BLS - 150", metricDate: new Date("2026-10-29T20:15:00-03:00"), valorCents: 2859800, currency: "BRL", currencyStatus: "known", simulator: "GTO", simulatorId: "gto", syncStatus: "SERVER_CONFIRMED" };
export const html = renderToStaticMarkup(<DriverActivityRow trip={trip as any} company={{ companyName: "DC Transportes" }} number={45} onDetails={() => undefined} />);`);
const out = path.join(dir, "out.mjs");
await build({ entryPoints: [entry], outfile: out, bundle: true, format: "esm", platform: "node", jsx: "automatic", loader: { ".css": "empty" }, logLevel: "error",
  external: ["react", "react-dom", "react-dom/server", "firebase", "firebase/*", "@capacitor/*", "lucide-react"], absWorkingDir: process.cwd() });
const { html } = await import(pathToFileURL(out).href);
const value = html.match(/<div class="nvu-driver-activity-value">([\s\S]*?)<\/div>/)?.[1] || "";
assert(value, "The value column renders: " + html.slice(0, 300));
assert.doesNotMatch(html, /GTO|WBDS|gto|simulador/i, "No simulator anywhere in the row");
assert.equal((value.match(/<strong>/g) || []).length, 1, "One money figure");
assert.match(value, /R\$\s?28\.598,00/);
assert.match(html, /Viagem 45/);
assert.doesNotMatch(value, /<\/strong><span>[^<]*<\/span>/, "No plain text line between the value and the send status (the old simulator line)");
console.log("PASS Activity row: value and send status only, no simulator");
console.log("ACTIVITY_ROW_PASS 1 check");
await fs.rm(dir, { recursive: true, force: true });
