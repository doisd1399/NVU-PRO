import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { build } from "esbuild";

// The driver's current-operation card ("Painel do motorista"): the real component with the built production stylesheets.
// It must look like the "Trabalhos ativos" card (same classes/styles) minus the driver row, be visible in the light theme,
// and its start button keeps the reflection and takes the colour of the figures card.
let playwright;
try { playwright = await import("playwright"); }
catch { playwright = await import(pathToFileURL(path.join(process.env.CODEX_PRIMARY_RUNTIME_NODE_MODULES, "playwright/index.mjs")).href); }
const root = process.cwd(), errors = [], results = [];
const assets = await fs.readdir("dist/assets");
const rank = n => n.startsWith("vendor-") ? 0 : n.startsWith("index-") ? 1 : 2;
const names = assets.filter(n => n.endsWith(".css")).sort((a, b) => rank(a) - rank(b));
assert(names.some(n => n.startsWith("DriverWorkspace-")) && names.some(n => n.startsWith("ManagementDashboard-")), "Run npm run build first");
const css = (await Promise.all(names.map(n => fs.readFile(path.join("dist/assets", n), "utf8")))).join("\n");
const photo = "data:image/svg+xml;base64," + Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="1000" height="435"><rect width="1000" height="435" fill="#3c6e71"/><rect y="300" width="1000" height="135" fill="#2a2a2a"/></svg>').toString("base64");
const bundle = await build({ stdin: { sourcefile: "card-qa.tsx", resolveDir: root, loader: "tsx", contents: `
import React,{useState} from "react";import {createRoot} from "react-dom/client";
import {DriverOperationCard} from "./src/components/driver/DriverOperationCard";
window.__events=[];
function App(){const [state,set]=useState({finish:false,busy:false,error:"",pending:false,src:${JSON.stringify(photo)}});window.__card=set;
return <main className="nvu-workspace-theme nvu-driver-workspace" style={{padding:14,background:"var(--driver-page)",minHeight:"100vh"}}>
<header className="nvu-driver-page-heading" data-page="dashboard"><div><h1>Painel do motorista</h1><p>Acompanhe suas entregas e o prazo.</p></div></header>
<div data-testid="column" style={{display:"flex",flexDirection:"column"}}>
<DriverOperationCard
 photo={{src:state.src,busy:false,canEdit:true,error:state.error,pending:state.pending,inputRef:null,onFileSelected:()=>{},onPick:()=>window.__events.push("pick")}}
 info={{id:"info-sheet",open:false,onOpen:()=>window.__events.push("info")}}
 finish={state.finish?{heading:"Entregas concluídas!",label:"Finalizar Operação",disabled:false,onFinish:()=>window.__events.push("finish")}:null}
 vehicle={{name:"Scania G",trailer:"Bitrem Graneleiro 4 eixos",operationName:"BLS - 150",onPaints:()=>window.__events.push("paints")}}
 progress={{done:9,total:10,remaining:1,percent:90,replayKey:"qa"}}
 timing={{remaining:"Prazo vencido",disabled:false,busy:state.busy,onStart:()=>window.__events.push("start")}}
 status={{online:true,suspended:false,onChange:v=>window.__events.push("online:"+v)}} />
</div>
<span data-testid="accent-probe" style={{color:"var(--driver-accent)"}}>.</span>
<div className="nvu-central-page" data-testid="panel-probe"><div className="nvu-central-vehicle-photo" data-testid="panel-photo" style={{width:300}}/></div>
</main>;}
createRoot(document.getElementById("root")).render(<App/>);` }, bundle: true, write: false, format: "iife", platform: "browser", jsx: "automatic",
  loader: { ".css": "empty" }, define: { "process.env.NODE_ENV": '"test"' } });
const html = `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>${css}</style></head><body><div id="root"></div><script>${bundle.outputFiles[0].text.replace(/<\/script/gi, "<\\/script")}</script></body></html>`;
const browser = await playwright.chromium.launch({ headless: true,
  ...(process.env.NVU_CHROMIUM_EXECUTABLE ? { executablePath: process.env.NVU_CHROMIUM_EXECUTABLE } : {}), args: ["--no-sandbox", "--disable-dev-shm-usage"] });
const rgb = value => (value.match(/[\d.]+/g) || []).slice(0, 3).map(Number);
const distance = (a, b) => Math.max(...rgb(a).map((n, i) => Math.abs(n - rgb(b)[i])));
const luminance = value => { const [r, g, b] = rgb(value); return .2126 * r + .7152 * g + .0722 * b; };
try {
  const context = await browser.newContext();
  await context.route("**/*", async route => {
    const u = new URL(route.request().url());
    assert.equal(u.hostname, "127.0.0.1", "Only isolated local assets are allowed");
    if (u.pathname.startsWith("/assets/")) return route.fulfill({ body: await fs.readFile(path.join(root, "public", u.pathname)), contentType: "font/woff2" });
    return route.fulfill({ body: html, contentType: "text/html" });
  });
  const page = await context.newPage(); page.on("pageerror", error => errors.push(error.message));
  await page.goto("http://127.0.0.1:43831/"); await page.getByTestId("driver-operation-card").waitFor();
  await page.evaluate(() => document.fonts.ready);

  for (const dark of [false, true]) for (const width of [320, 360, 390, 412, 768]) {
    await page.setViewportSize({ width, height: 900 });
    await page.evaluate(dark => document.documentElement.classList.toggle("dark", dark), dark);
    await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    const m = await page.evaluate(() => {
      const q = s => document.querySelector(s), box = n => { const r = n.getBoundingClientRect(); return { top: r.top, bottom: r.bottom, left: r.left, right: r.right, width: r.width, height: r.height }; };
      const card = q('[data-testid="driver-operation-card"]'), photo = q(".nvu-driver-op-photo"), line = q(".nvu-central-vehicle-line"), stats = q(".nvu-central-operation-stats");
      const button = q(".nvu-driver-start-work"), time = q('[data-testid="driver-remaining-time"]'), status = q(".nvu-driver-status-row"), icon = button.querySelector("svg");
      const heading = q(".nvu-driver-page-heading"), page = q("main");
      const remaining = (() => { const line = time.getBoundingClientRect(), parts = [...time.children].map(n => { const r = n.getBoundingClientRect(); return { cy: r.top + r.height / 2, left: r.left, right: r.right }; }); const cardRect = card.getBoundingClientRect(); return { cys: parts.map(p => p.cy), leftGap: Math.min(...parts.map(p => p.left)) - cardRect.left, rightGap: cardRect.right - Math.max(...parts.map(p => p.right)), lineCenter: line.left + line.width / 2, cardCenter: cardRect.left + cardRect.width / 2 }; })();
      return { remaining, driverRow: card.querySelectorAll(".nvu-central-driver-row,.nvu-central-avatar,.nvu-central-job-status,.nvu-central-operation-toggle").length,
        boxes: { photo: box(photo), line: box(line), stats: box(stats), button: box(button), time: box(time), status: box(status), card: box(card) },
        ratio: box(photo).width / box(photo).height, panelRatio: (() => { const p = box(q('[data-testid="panel-photo"]')); return p.width / p.height; })(),
        buttonBg: getComputedStyle(button).backgroundColor, statsBg: getComputedStyle(stats).backgroundColor, buttonColor: getComputedStyle(button).color,
        icon: { fill: getComputedStyle(icon).fill, color: getComputedStyle(icon).color }, accent: getComputedStyle(q('[data-testid="accent-probe"]')).color, reflection: { name: getComputedStyle(button, "::after").animationName, duration: getComputedStyle(button, "::after").animationDuration },
        cardBg: getComputedStyle(card).backgroundColor, pageBg: getComputedStyle(page).backgroundColor, border: getComputedStyle(card).borderTopWidth + " " + getComputedStyle(card).borderTopColor,
        title: heading.querySelector("h1").textContent, descriptionSize: getComputedStyle(heading.querySelector("p")).fontSize,
        infoInLine: Boolean(line.querySelector('button[aria-label="Informações da operação em andamento"]')),
        overflow: document.documentElement.scrollWidth > innerWidth };
    });
    const tag = `${dark ? "dark" : "light"} ${width}`;
    assert.equal(m.driverRow, 0, `${tag}: no driver photo, name, situation or collapse arrow in the card`);
    const b = m.boxes;
    assert(b.photo.top < b.line.top && b.line.top < b.stats.top && b.stats.top < b.button.top && b.button.top < b.time.top && b.time.top < b.status.top, `${tag}: order photo > vehicle > figures > start > time > status`);
    assert(b.time.top >= b.button.bottom - .5 && b.time.top - b.button.bottom <= 16, `${tag}: the remaining time sits below the start button`);
    // The remaining-time line: icon, label and value on one centre line, and the group centred in the card.
    assert(Math.max(...m.remaining.cys) - Math.min(...m.remaining.cys) <= 1.2, `${tag}: icon, label and value are vertically aligned ${m.remaining.cys}`);
    assert(Math.abs(m.remaining.leftGap - m.remaining.rightGap) <= 2, `${tag}: the remaining-time group is centred (${m.remaining.leftGap} / ${m.remaining.rightGap})`);
    assert(b.time.top - b.button.bottom >= 8, `${tag}: breathing room between the start button and the remaining time (${b.time.top - b.button.bottom}px)`);
    // The lower area is compact: start button, remaining time and the availability row take little height.
    assert(b.status.height <= 38, `${tag}: availability row ${b.status.height}px`);
    assert(b.status.bottom - b.button.top <= 136, `${tag}: start button + remaining time + status take ${b.status.bottom - b.button.top}px`);
    assert(b.button.height <= 40, `${tag}: start button ${b.button.height}px`);
    assert(Math.abs(m.ratio - 2.3) < .03, `${tag}: vehicle photo proportion ${m.ratio}`);
    assert(Math.abs(m.ratio - m.panelRatio) < .01, `${tag}: same photo proportion as "Trabalhos ativos" (${m.ratio} / ${m.panelRatio})`);
    assert.equal(m.buttonBg, m.statsBg, `${tag}: the start button has the colour of the figures card`);
    assert.equal(m.icon.fill, m.icon.color, `${tag}: filled arrow`);
    assert.equal(m.icon.color, m.accent, `${tag}: the arrow keeps the accent blue of the driver workspace`);
    assert(dark ? luminance(m.buttonColor) > 200 : luminance(m.buttonColor) < 90, `${tag}: label ${m.buttonColor}`);
    assert.equal(m.reflection.name, "nvu-operation-start-reflection", `${tag}: reflection animation kept`);
    assert.equal(m.reflection.duration, "3s");
    assert.equal(m.title, "Painel do motorista");
    assert.equal(m.descriptionSize, "10px", `${tag}: page description is a little smaller`);
    assert(m.infoInLine, `${tag}: the (i) button is in the vehicle line`);
    assert(!m.overflow, `${tag}: no horizontal overflow`);
    // The card is visible against the page in both themes (before, in the light theme it had the page colour).
    assert(distance(m.cardBg, m.pageBg) >= (dark ? 8 : 6) || /[1-9]/.test(m.border.split(" ")[0]), `${tag}: card ${m.cardBg} vs page ${m.pageBg}`);
    if (!dark) { assert.equal(m.border.split(" ")[0], "1px", "light: the card has a border"); assert(distance(m.border.slice(m.border.indexOf("rgb")), m.pageBg) >= 6, `light: border ${m.border} vs page ${m.pageBg}`); assert.notEqual(m.cardBg, m.pageBg, "light: card surface differs from the page"); }
    results.push({ tag, ratio: +m.ratio.toFixed(3), card: m.cardBg, page: m.pageBg });
    if (width === 390) { await fs.mkdir("verification/driver-operation-card", { recursive: true }); await page.screenshot({ path: `verification/driver-operation-card/${dark ? "dark" : "light"}-390.png`, fullPage: true }); }
  }

  // Desktop and tablet windows: more air between the page description and the cards (phones keep the compact gap).
  for (const [width, height, wide] of [[1280, 800, true], [1024, 768, true], [390, 900, false]]) {
    await page.setViewportSize({ width, height });
    await page.evaluate(wide => { document.querySelector("main").classList.toggle("nvu-landscape-dashboard", wide); }, wide);
    const gap = await page.evaluate(() => { const p = document.querySelector(".nvu-driver-page-heading p").getBoundingClientRect(), c = document.querySelector('[data-testid="column"]').getBoundingClientRect(); return c.top - p.bottom; });
    if (wide) assert(gap >= 26, `${width}x${height}: ${gap}px between the description and the cards`); else assert(gap >= 12 && gap <= 22, `${width}x${height}: phones keep a compact gap (${gap}px)`);
    results.push({ tag: `breathing ${width}x${height}`, gap });
  }
  await page.evaluate(() => document.querySelector("main").classList.remove("nvu-landscape-dashboard"));

  // Behaviour: every action of the old card still works.
  await page.setViewportSize({ width: 390, height: 900 });
  await page.getByRole("button", { name: "Iniciar trabalho", exact: true }).click();
  await page.getByRole("button", { name: "Substituir foto do veículo" }).click();
  await page.getByRole("button", { name: "Informações da operação em andamento" }).click();
  await page.getByRole("button", { name: "Ver pinturas do veículo e reboque" }).click();
  await page.getByLabel("Disponível para fretes").evaluate(input => input.click());
  assert.deepEqual(await page.evaluate(() => window.__events), ["start", "pick", "info", "paints", "online:false"]);
  await page.evaluate(() => { window.__events.length = 0; window.__card(s => ({ ...s, finish: true })); });
  await page.getByTestId("driver-operation-finish").waitFor();
  assert.match(await page.getByTestId("driver-operation-finish").innerText(), /Entregas concluídas!/);
  await page.getByRole("button", { name: "Finalizar Operação" }).click();
  assert.deepEqual(await page.evaluate(() => window.__events), ["finish"]);
  await page.evaluate(() => window.__card(s => ({ ...s, finish: false, error: "Falha ao salvar a foto.", pending: true, src: "" })));
  await page.getByRole("alert").waitFor();
  assert.equal(await page.getByRole("button", { name: "Adicionar foto do veículo" }).count(), 1, "empty photo state offers to add one");
  await page.evaluate(() => window.__card(s => ({ ...s, busy: true })));
  await page.getByRole("button", { name: "Preparando…" }).waitFor();
  assert.equal(await page.getByRole("button", { name: "Preparando…" }).evaluate(button => getComputedStyle(button, "::after").animationName), "none", "busy stops the reflection");
  assert.deepEqual(errors, []);
  await fs.mkdir("reports", { recursive: true });
  await fs.writeFile("reports/driver-operation-card-ui.json", JSON.stringify({ result: "PASS", browser: browser.version(), results }, null, 2));
  console.log(`DRIVER_OPERATION_CARD_UI_PASS (${results.length} layouts + actions/finish/photo/busy checks)`);
} finally { await browser.close(); }
