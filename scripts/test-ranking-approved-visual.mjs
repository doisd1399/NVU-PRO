import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { build } from "esbuild";

// Actual RankingGlobal/components + actual production CSS. Only remote/session
// adapters and the participant-modal boundary are fixtures; no Firebase access.
const root = process.cwd();
const output = path.resolve(process.env.NVU_RANKING_QA_DIR || "verification/ranking-approved");
await fs.mkdir(output, { recursive: true });
let playwright;
try { playwright = await import("playwright"); }
catch { playwright = await import(pathToFileURL(path.join(process.env.CODEX_PRIMARY_RUNTIME_NODE_MODULES, "playwright/index.mjs")).href); }
const photos = {};
for (const name of ["matecom", "cooper", "cocal"]) {
  photos[name] = `data:image/png;base64,${(await fs.readFile(`scripts/fixtures/ranking-approved/logo-${name}.png`)).toString("base64")}`;
}
const builtAssets = await fs.readdir("dist/assets");
// Match production order: global CSS, shared workspace/pickers, then lazy page CSS.
const cssFiles = ["vendor", "index", "DriverWorkspace", "ModalSelect", "RankingPeriodModal", "RankingGlobal"]
  .flatMap(prefix => builtAssets.filter(name => name.startsWith(prefix + "-") && name.endsWith(".css")));
assert.ok(cssFiles.length, "Run npm run build first");
const css = (await Promise.all(cssFiles.map(name => fs.readFile(path.join("dist/assets", name), "utf8")))).join("\n");
const mocks = `
import React,{useState,useMemo} from "react";
import {Bell} from "lucide-react";
import {DriverDock} from "./src/components/driver/DriverDock";
import {parseRankingAggregateDocument} from "./src/lib/rankingAggregates";
const photos=${JSON.stringify(photos)};
const companyNames=["MATECOM","Cooper log Transporte e Logística","COCAL TRANSPORTE","QUARTA EMPRESA","QUINTA EMPRESA"];
const ids=["matecom","cooper","cocal","fourth","fifth"];
const amounts=[4960378,1352450,755357,120000,10000],counts=[193,90,55,12,1];
export const companies=ids.map((id,i)=>({id,name:companyNames[i],companyName:companyNames[i],logo:photos[id]||"",logoUrl:photos[id]||"",simulatorId:"gto",status:"active"}));
export const users=ids.map((id,i)=>({id:"driver-"+id,name:["Sofia Alves","Tiago Moura","Ana Costa","Quarto Motorista","Quinto Motorista"][i],companyId:id,companyName:companyNames[i],val:amounts[i],trips:counts[i],currency:"BRL",logo:photos[id]||"",profilePhotoURL:photos[id]||"",roles:["driver"]}));
const simulators=[{id:"gto",name:"GTO"}],empty=[],noop=()=>{},load=async()=>{};
const members=users.map(u=>({userId:u.id,companyId:u.companyId,status:"active",roles:["driver"]}));
const trips=users.map((u,i)=>({id:"trip-"+i,driverId:u.id,companyId:u.companyId,simulatorId:"gto",status:"concluida",valor:u.val,currency:"BRL",currencyStatus:"known",completedAt:"2026-10-18T12:00:00Z"}));
export function useSessionStore(){return {currentUser:users[0],activeRole:"driver"};}
export function useOperationalStore(){return {simulators,simulatorsLoading:false,users,jobs:empty,vehicles:empty};}
export function useCompanyStore(){return {activeCompanyId:"matecom",allCompanies:companies,companies,companiesLoading:false,companyCatalogLoaded:true,companyCatalogAttempted:true,loadCompanyCatalog:load,allCompanyMembers:members};}
export function useNotificationStore(){return {notifications:empty,markNotificationAsRead:noop};}
export function useRankingFilterStore(){const [p,setP]=useState("mes"),[s,setS]=useState(""),[e,setE]=useState("");return {globalPeriodPreset:p,setGlobalPeriodPreset:setP,globalStartDateStr:s,setGlobalStartDateStr:setS,globalEndDateStr:e,setGlobalEndDateStr:setE};}
export function useLiveCalendarReference(){return useMemo(()=>new Date("2026-10-18T12:00:00Z"),[]);}
export function useRankingAggregate(options){const aggregate=useMemo(()=>{
 const previous=String(options.periodKey).includes("2026-09");
 const companyMetrics=Object.fromEntries(ids.map((id,i)=>[id,{val:previous&&i===0?7463527.55:amounts[i],trips:previous&&i===0?420:counts[i],currency:"BRL"}]));
 return parseRankingAggregateDocument({schemaVersion:4,simulatorId:options.simulatorId,periodType:options.periodType,periodKey:options.periodKey,periodTimeZone:"America/Sao_Paulo",periodPolicy:"SAO_PAULO_CALENDAR",complete:true,sourceTripCount:351,companies:companyMetrics,drivers:Object.fromEntries(users.map(u=>[u.id,{...u,val:previous&&u.id===users[0].id?7463527.55:u.val,trips:previous&&u.id===users[0].id?420:u.trips}]))});
},[options.simulatorId,options.periodType,options.periodKey]);return {aggregate:options.enabled?aggregate:null,status:"ready",loading:false,refreshing:false,error:null};}
export function useRankingCompaniesByIds(){return {companies,loading:false,refreshing:false,complete:true,serverConfirmed:true,error:null};}
export function useRankingUsersRealtime(){return {users,loading:false,refreshing:false,error:null};}
export function useTripsRealtime(){return {trips,loading:false,refreshing:false,serverConfirmed:true,error:null};}
export const auth={currentUser:{uid:users[0].id}},db={},functions={};
export const warmRankingPhotosForIds=load,warmRankingUserProfiles=load;
export function useRankingVehiclePhotoPrefetch(){}
export function NotificationCenter(){return <button aria-label="Notificações"><Bell size={21}/></button>;}
export function WorkspaceDock(){return <><div className="nvu-workspace-dock-space"/><DriverDock active="ranking" onSelect={id=>window.__dockSelected=id}/></>;}
export default function Modal({item,rank,onClose}){return <div role="dialog" data-testid="profile-handoff"><span>{item.id} / {rank}</span><button onClick={onClose}>Fechar perfil</button></div>;}
`;
const intercept = new Set(["AppContext.tsx", "CompanyContext.tsx", "NotificationsContext.tsx", "useRankingAggregate.ts", "useRankingCompaniesByIds.ts", "useRankingUsersRealtime.ts", "useTripsRealtime.ts", "useLiveCalendarReference.ts", "useRankingVehiclePhotoPrefetch.ts", "rankingPhotoWarmup.ts", "firebase.ts", "NotificationCenter.tsx", "RankingParticipantPremiumModal.tsx", "WorkspaceDock.tsx"]);
const bundle = await build({
  stdin: { sourcefile: "ranking-approved-qa.tsx", resolveDir: root, loader: "tsx", contents: `
import React,{useState} from "react";import {createRoot} from "react-dom/client";import {MemoryRouter} from "react-router-dom";
import RankingGlobal from "./src/pages/RankingGlobal";import RankingPremiumPodium from "./src/components/RankingPremiumPodium";import {RankingGamerLeaderboard} from "./src/components/RankingGamerLeaderboard";import {RankingPreviousPeriodCard} from "./src/components/RankingPreviousPeriodCard";
import {companies} from "ranking-fixtures";
window.__rawCompanyNames=companies.map(c=>c.name);window.__menuOpened=0;addEventListener("nvu-open-shell-menu",()=>window.__menuOpened++);
function Edge(){const [scenario,setScenario]=useState("long");window.__setRankingScenario=setScenario;const base=companies.slice(0,3).map((c,i)=>({...c,trips:[193,90,55][i],logo:c.logoUrl,val:9999999999.99}));const items=scenario==="single"?base.slice(0,1):scenario==="missing"?base.map(c=>({...c,logo:""})):base;const money=()=>scenario==="mixed"?"R$ 1.234.567,89 · € 98.765,43":"R$ 9.999.999.999,99";return <div className="nvu-gamer-ranking nvu-ranking-page"><div className="nvu-gamer-content"><RankingPremiumPodium items={items} viewerId="edge" assetType="company" formatCurrency={money} onOpen={()=>{}}/><RankingGamerLeaderboard items={items} viewerId="edge" assetType="company" showPhotos criticalLimit={3} formatCurrency={money} onOpen={()=>{}}/><RankingPreviousPeriodCard leader={base[0]} viewerId="edge" assetType="company" periodLabel="Mês anterior" earnings={money()} comparison={null}/></div></div>;}
const edge=location.search.includes("edge");createRoot(document.getElementById("root")).render(edge?<Edge/>:<MemoryRouter initialEntries={[{pathname:"/ranking",state:{profileRanking:{type:"entre",simulatorId:"gto",periodType:"mes"}}}]}><div className="nvu-native-android nvu-ranking-overlay" style={{position:"fixed",inset:0,overflowY:"auto"}}><RankingGlobal/></div></MemoryRouter>);
` },
  bundle: true, write: false, outfile: path.join(output, "fixture.js"), format: "iife", platform: "browser", jsx: "automatic", loader: { ".css": "empty" },
  define: { "process.env.NODE_ENV": '"test"', "import.meta.env.BASE_URL": '"/"' },
  plugins: [{ name: "isolated-ranking-adapters", setup(plugin) {
    plugin.onResolve({ filter: /^ranking-fixtures$/ }, () => ({ path: "fixtures", namespace: "ranking-fixture" }));
    plugin.onLoad({ filter: /.*/, namespace: "ranking-fixture" }, () => ({ contents: mocks, resolveDir: root, loader: "tsx" }));
    plugin.onLoad({ filter: /src\/.*\.tsx?$/ }, args => intercept.has(path.basename(args.path)) ? { contents: 'export * from "ranking-fixtures";export {default} from "ranking-fixtures";', resolveDir: root, loader: "tsx" } : undefined);
  } }],
});
const js = bundle.outputFiles.find(file => file.path.endsWith(".js")).text;
const html = `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>${css}</style></head><body><div id="root"></div><script>${js.replace(/<\/script/gi, "<\\/script")}</script></body></html>`;
await fs.writeFile(path.join(output, "fixture.html"), html);
const browser = await playwright.chromium.launch({ headless: true, ...(process.env.NVU_CHROMIUM_EXECUTABLE ? { executablePath: process.env.NVU_CHROMIUM_EXECUTABLE } : {}), args: ["--no-sandbox", "--disable-dev-shm-usage"] });
const context = await browser.newContext({ viewport: { width: 390, height: 867 }, deviceScaleFactor: 2 });
const external = [], errors = [], results = [];
await context.route("**/*", async route => {
  const url = new URL(route.request().url());
  if (url.hostname !== "127.0.0.1") { external.push(url.href); return route.abort(); }
  if (url.pathname.startsWith("/assets/") || url.pathname.startsWith("/vendor/")) {
    const file = path.join(root, "public", url.pathname);
    return route.fulfill({ body: await fs.readFile(file), contentType: url.pathname.endsWith(".js") ? "application/javascript" : url.pathname.endsWith("woff2") ? "font/woff2" : "image/png" });
  }
  return route.fulfill({ body: html, contentType: "text/html" });
});
const page = await context.newPage();
page.on("pageerror", error => errors.push(error.message));
async function check(name, run) { await run(); results.push({ name, pass: true }); console.log("PASS " + name); }
async function ready() {
  await page.getByTestId("ranking-premium-podium").waitFor();
  await page.evaluate(() => document.fonts.ready);
  await page.waitForFunction(() => [...document.querySelectorAll(".nvu-podium-photo img")].every(image => image.complete && image.naturalWidth > 0));
}
try {
  await page.goto("http://127.0.0.1:43821/");
  await ready();
  await page.getByTestId("ranking-previous-leader-card").waitFor();
  await check("Approved labels, amounts, trips and unchanged source identities", async () => {
    assert.deepEqual(await page.locator(".nvu-gamer-row-name").allTextContents(), ["Matecom", "Cooper Log", "Cocal Transporte"]);
    assert.deepEqual(await page.locator(".nvu-podium-name").allTextContents(), ["Cooper Log", "Matecom", "Cocal Transporte"]);
    assert.deepEqual(await page.locator("[data-testid^='podium-place-']").evaluateAll(items => items.map(item => item.dataset.participantId)), ["cooper", "matecom", "cocal"]);
    const text = (await page.locator(".nvu-gamer-leaderboard").innerText()).replace(/\s/g, " ");
    for (const amount of ["R$ 4.960.378,00", "R$ 1.352.450,00", "R$ 755.357,00", "193 viagens", "90 viagens", "55 viagens"]) assert.ok(text.includes(amount), amount);
    assert.deepEqual(await page.evaluate(() => window.__rawCompanyNames.slice(0, 3)), ["MATECOM", "Cooper log Transporte e Logística", "COCAL TRANSPORTE"]);
    const previous = (await page.getByTestId("ranking-previous-leader-card").innerText()).replace(/\s/g, " ");
    for (const value of ["Período concluído", "Matecom", "7.463.527,55", "420 viagens", "−R$ 2.503.149,55"]) assert.ok(previous.includes(value), previous);
  });
  await check("Small badge above company, one-line footer, no obsolete frames/columns", async () => {
    const badge = await page.locator(".nvu-gamer-leader-label").boundingBox();
    const name = await page.locator(".nvu-gamer-row-name").first().boundingBox();
    assert.ok(badge.y + badge.height <= name.y + 1);
    assert.equal(await page.locator(".nvu-gamer-frame,.nvu-gamer-rank,.nvu-gamer-columns").count(), 0);
    assert.equal(await page.locator(".nvu-gamer-more-inline > span").evaluate(node => node.getBoundingClientRect().height < 26), true);
    assert.equal(await page.locator("[data-testid='ranking-row-1']").isDisabled(), true);
  });
  await check("Ranking uses the exact management wordmark",async()=>{
    const wordmark=await page.locator('.nvu-ranking-app-header .nvu-wordmark').evaluate(n=>{const s=getComputedStyle(n);return [s.fontSize,s.fontWeight,s.letterSpacing];});
    assert.deepEqual(wordmark,["18px","700","-0.45px"]);
  });
  for (const width of [320, 360, 390, 412, 768]) for (const theme of ["light", "dark"]) {
    await page.setViewportSize({ width, height: Math.round(width * 1536 / 691) });
    await page.evaluate(value => { document.documentElement.className = value === "dark" ? "dark" : ""; }, theme);
    await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    await check(`Layout and neutral winner border: ${width}px / ${theme}`, async () => {
      const geometry = await page.evaluate(() => ({
        width: innerWidth, scroll: document.documentElement.scrollWidth,
        pageColor:getComputedStyle(document.querySelector(".nvu-ranking-page")).backgroundColor,
        bodyColor:getComputedStyle(document.body).backgroundColor,
        dockColor:getComputedStyle(document.querySelector(".nvu-driver-dock")).backgroundColor,
        amounts: [...document.querySelectorAll(".nvu-gamer-money > span,.nvu-gamer-previous-delta strong")].map(node => ({ width: node.clientWidth, scroll: node.scrollWidth })),
        podium: [...document.querySelectorAll(".nvu-podium-participant")].map(node => {
          const r = node.getBoundingClientRect(), photo = node.querySelector(".nvu-podium-portrait-shell").getBoundingClientRect();
          const place = node.querySelector(".nvu-podium-place").getBoundingClientRect(), name = node.querySelector(".nvu-podium-name").getBoundingClientRect();
          const plinth = node.querySelector(".nvu-podium-plinth").getBoundingClientRect();
          return { left: r.left, right: r.right, photoBottom: photo.bottom, placeTop: place.top, placeBottom: place.bottom, nameTop: name.top,
            seatOffset: (place.top - plinth.top) / plinth.height, shape: node.querySelector(".nvu-podium-front").getAttribute("d") };
        }),
        borders: [...document.querySelectorAll(".nvu-podium-portrait-shell")].map(node => getComputedStyle(node).borderColor),
      }));
      assert.ok(geometry.scroll <= geometry.width, JSON.stringify(geometry));
      assert.equal(geometry.pageColor,geometry.bodyColor,"Ranking must use the shared page palette");
      assert.notEqual(geometry.dockColor,geometry.pageColor,"The dock keeps its shared strip surface");
      assert.ok(geometry.amounts.every(item => item.scroll <= item.width + 1), JSON.stringify(geometry));
      assert.ok(geometry.podium.every(item => item.left >= 0 && item.right <= width), JSON.stringify(geometry));
      assert.equal(new Set(geometry.podium.map(item => item.shape)).size, 1, "All positions use the same sculpted seat");
      assert.ok(geometry.podium.every(item => item.placeTop >= item.photoBottom && item.placeBottom <= item.nameTop + 1), JSON.stringify(geometry.podium));
      assert.ok(geometry.podium.every(item => Math.abs(item.seatOffset - .25) < .01), JSON.stringify(geometry.podium));
      assert.equal(new Set(geometry.borders).size, 1, "Winner must have the same neutral edge as the other holders");
      assert.equal(await page.locator(".nvu-podium-gold .nvu-gamer-frame").count(), 0);
    });
    if (width === 390) {
      await page.screenshot({ path: path.join(output, `ranking-${theme}-390.png`), animations: "disabled" });
    }
  }
  await page.setViewportSize({ width: 390, height: 867 });
  for (const theme of ["light", "dark"]) {
    await page.goto("http://127.0.0.1:43821/");
    await page.evaluate(value => { document.documentElement.className = value === "dark" ? "dark" : ""; }, theme);
    await ready();
    await page.screenshot({ path: path.join(output, `ranking-fresh-${theme}-390.png`), animations: "disabled" });
  }
  await page.evaluate(() => { document.documentElement.className = ""; });
  await check("Expand/collapse participants keeps all five identities and total", async () => {
    const more = page.getByRole("button", { name: "Ver demais participantes", exact: true });
    assert.equal(await more.getAttribute("aria-expanded"), "false");
    await more.click();
    assert.equal(await page.locator(".nvu-gamer-row").count(), 5);
    assert.equal(await page.locator(".nvu-gamer-participant-count").innerText(), "5 empresas");
    await page.getByRole("button", { name: "Recolher participantes", exact: true }).click();
    assert.equal(await page.locator(".nvu-gamer-row").count(), 3);
  });
  await check("Real filter expansion, shared simulator picker and date picker", async () => {
    assert.equal(await page.getByRole("button", { name: "Simulador", exact: true }).isVisible(), false);
    await page.getByRole("button", { name: /^Filtros do ranking:/ }).click();
    const simulatorButton = page.getByRole("button", { name: "Simulador", exact: true });
    assert.equal((await simulatorButton.innerText()).trim(), "GTO");
    assert.equal(await simulatorButton.locator("svg.lucide-gamepad-2").count(), 1);
    assert.equal(await simulatorButton.locator("svg.lucide-chevron-down").count(), 0);
    const simulatorBox = await simulatorButton.boundingBox(), periodBox = await page.getByRole("button", {name:"Escolher período do ranking"}).boundingBox();
    assert.equal(simulatorBox.height, periodBox.height);
    assert.equal(await simulatorButton.evaluate(node=>getComputedStyle(node).justifyContent), "center");
    await simulatorButton.click();
    await page.getByRole("dialog").waitFor();
    const options = page.getByRole("dialog").getByRole("option");
    await options.filter({ hasText: "GTO" }).first().click();
    assert.equal(await page.getByRole("dialog").count(), 0);
    await page.getByRole("button", { name: "Escolher período do ranking" }).click();
    const dialog = page.getByRole("dialog", { name: "Filtrar por período" });
    await dialog.waitFor();
    assert.equal(await page.locator('input[type="date"]').count(), 0);
    assert.equal(await dialog.getByRole("grid").count(), 1);
    await dialog.getByRole("button", { name: "Aplicar filtro", exact: true }).click();
    assert.equal(await page.getByRole("dialog").count(), 0);
  });
  const periodButton = page.getByRole("button", { name: "Escolher período do ranking" });
  const filterSummary = page.getByRole("button", { name: /^Filtros do ranking:/ });
  const periodDialog = () => page.getByRole("dialog", { name: "Filtrar por período" });
  const day = key => periodDialog().locator(`[data-day="${key}"]:not([data-outside]) button`);
  await check("Period edits are drafts; Escape, Cancel and backdrop preserve applied filter and focus", async () => {
    const before = await filterSummary.getAttribute("aria-label");
    await periodButton.click();
    await periodDialog().getByRole("button", { name: "Semana atual", exact: true }).click();
    assert.equal(await filterSummary.getAttribute("aria-label"), before);
    await page.keyboard.press("Escape");
    assert.equal(await page.getByRole("dialog").count(), 0);
    assert.equal(await periodButton.evaluate(node => node === document.activeElement), true);
    await periodButton.click();
    await day("2026-10-25").click();
    assert.equal(await periodDialog().getByRole("button", { name: "Aplicar filtro" }).isDisabled(), true);
    await periodDialog().getByRole("button", { name: "Cancelar", exact: true }).click();
    assert.equal(await filterSummary.getAttribute("aria-label"), before);
    await periodButton.click();
    await periodDialog().getByRole("button", { name: "Semana atual", exact: true }).click();
    await page.locator(".nvu-period-overlay").click({ position: { x: 2, y: 2 } });
    assert.equal(await filterSummary.getAttribute("aria-label"), before);
  });
  await check("Range crosses months, reverse clicks normalize, apply persists endpoints on reopen", async () => {
    await periodButton.click();
    await day("2026-10-30").click();
    await periodDialog().getByRole("button", { name: "Ir para o próximo mês", exact: true }).click();
    await day("2026-11-03").click();
    assert.equal(await periodDialog().locator(".rdp-range_start").count(), 0); // Start remains in previous month.
    assert.match(await periodDialog().getByRole("status").last().innerText(), /30.*out.*2026.*03.*nov.*2026/);
    await periodDialog().getByRole("button", { name: "Aplicar filtro" }).click();
    assert.match(await filterSummary.getAttribute("aria-label"), /30\/10\/2026.*03\/11\/2026/);
    await periodButton.click();
    assert.equal(await day("2026-10-30").locator("..").getAttribute("aria-selected"), "true");
    await day("2026-10-20").click();
    await day("2026-10-18").click();
    assert.equal(await day("2026-10-18").locator("..").evaluate(node => node.classList.contains("rdp-range_start")), true);
    assert.equal(await day("2026-10-20").locator("..").evaluate(node => node.classList.contains("rdp-range_end")), true);
    await periodDialog().getByRole("button", { name: "Aplicar filtro" }).click();
    assert.match(await filterSummary.getAttribute("aria-label"), /18\/10\/2026.*20\/10\/2026/);
  });
  await check("Same-day range, keyboard dates, presets, historical year and modal focus trap", async () => {
    await periodButton.click();
    await day("2026-10-18").click();
    await page.keyboard.press("Enter");
    assert.equal(await periodDialog().getByRole("button", { name: "Aplicar filtro" }).isEnabled(), true);
    await day("2026-10-18").focus();
    await page.keyboard.press("ArrowRight");
    assert.equal(await day("2026-10-19").evaluate(node => node === document.activeElement), true);
    await periodDialog().getByRole("button", { name: "Aplicar filtro" }).click();
    assert.match(await filterSummary.getAttribute("aria-label"), /18\/10\/2026.*18\/10\/2026/);
    await periodButton.click();
    await periodDialog().getByRole("combobox", { name: "Escolha o ano" }).selectOption("2024");
    await periodDialog().getByRole("combobox", { name: "Escolha o mês" }).selectOption("1");
    await day("2024-02-29").click();
    await day("2024-02-29").click();
    await periodDialog().getByRole("button", { name: "Semana atual", exact: true }).click();
    assert.equal(await periodDialog().getByRole("button", { name: "Semana atual", exact: true }).getAttribute("aria-pressed"), "true");
    assert.equal(await day("2026-10-18").locator("..").evaluate(node => node.classList.contains("rdp-range_start")), true);
    await periodDialog().getByRole("button", { name: "Aplicar filtro" }).focus();
    await page.keyboard.press("Tab");
    assert.equal(await periodDialog().getByRole("button", { name: "Fechar filtro de período" }).evaluate(node => node === document.activeElement), true);
    await page.keyboard.press("Shift+Tab");
    assert.equal(await periodDialog().getByRole("button", { name: "Aplicar filtro" }).evaluate(node => node === document.activeElement), true);
    await periodDialog().getByRole("button", { name: "Mês de Outubro", exact: true }).click();
    await periodDialog().getByRole("button", { name: "Aplicar filtro" }).click();
    assert.match(await filterSummary.getAttribute("aria-label"), /Mês de Outubro/);
  });
  for (const [width, height] of [[320, 568], [390, 867], [640, 360]]) for (const theme of ["light", "dark"]) {
    await page.setViewportSize({ width, height });
    await page.evaluate(value => document.documentElement.className = value === "dark" ? "dark" : "", theme);
    await periodButton.click();
    await check(`Compact calendar, visible actions and theme: ${width}×${height} / ${theme}`, async () => {
      const bounds = await periodDialog().boundingBox();
      assert.ok(bounds.x >= 0 && bounds.y >= 0 && bounds.x + bounds.width <= width + 1 && bounds.y + bounds.height <= height + 1, JSON.stringify(bounds));
      assert.equal(await periodDialog().evaluate(node => node.scrollWidth <= node.clientWidth), true);
      const apply = await periodDialog().getByRole("button", { name: "Aplicar filtro" }).boundingBox();
      assert.ok(apply.y >= 0 && apply.y + apply.height <= height);
      const colors = await periodDialog().evaluate(node => ({ panel: getComputedStyle(node).backgroundColor, text: getComputedStyle(node).color }));
      assert.equal(colors.panel, theme === "dark" ? "rgb(36, 52, 63)" : "rgb(255, 255, 255)");
      assert.notEqual(colors.panel, colors.text);
      if (width === 390) await page.screenshot({ path: path.join(output, `period-${theme}-390.png`), animations: "disabled" });
    });
    await page.keyboard.press("Escape");
  }
  await page.setViewportSize({ width: 390, height: 867 });
  await page.evaluate(() => document.documentElement.className = "");
  await check("Driver profile handoff and keyboard activation survive redesign", async () => {
    await page.getByRole("button", { name: "Global", exact: true }).click();
    await page.getByTestId("ranking-row-2").waitFor();
    await page.getByTestId("ranking-row-2").focus();
    await page.keyboard.press("Enter");
    assert.match(await page.getByTestId("profile-handoff").innerText(), /driver-cooper \/ 2/);
    await page.getByRole("button", { name: "Fechar perfil" }).click();
    await page.getByTestId("podium-place-1").click();
    assert.match(await page.getByTestId("profile-handoff").innerText(), /driver-matecom \/ 1/);
    await page.getByRole("button", { name: "Fechar perfil" }).click();
    await page.getByRole("button", { name: "Abrir menu do aplicativo" }).click();
    assert.equal(await page.evaluate(() => window.__menuOpened), 1);
  });
  await page.goto("http://127.0.0.1:43821/?edge");
  await ready();
  await page.setViewportSize({ width: 320, height: 800 });
  for (const scenario of ["long", "mixed", "missing", "single"]) {
    await page.evaluate(value => window.__setRankingScenario(value), scenario);
    await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    await check(`320px edge case: ${scenario}`, async () => {
      const geometry = await page.evaluate(() => ({ width: innerWidth, scroll: document.documentElement.scrollWidth, amounts: [...document.querySelectorAll(".nvu-gamer-money > span")].map(node => ({ width: node.clientWidth, scroll: node.scrollWidth })) }));
      assert.ok(geometry.scroll <= geometry.width, JSON.stringify(geometry));
      assert.ok(geometry.amounts.every(item => item.scroll <= item.width + 1), JSON.stringify(geometry));
      if (scenario === "single") assert.equal(await page.locator(".nvu-podium-vacancy").count(), 2);
      if (scenario === "missing") assert.equal(await page.locator(".nvu-podium-initials").count(), 3);
      assert.match(await page.getByTestId("ranking-previous-leader-card").innerText(), /Diferença indisponível/);
    });
  }
  assert.deepEqual(errors, []);
  assert.deepEqual(external, []);
  await fs.writeFile(path.join(output, "results.json"), JSON.stringify({ pass: true, checks: results.length, results, errors, externalRequests: external, limitations: ["Remote/session adapters and profile-modal boundary are fixtures; production Firebase and a physical Android device were not accessed.", "The screenshots use the real RankingGlobal components, generated production CSS and bundled fonts. Native system bars are supplied by Android, outside this WebView fixture."] }, null, 2));
  console.log(`RANKING_APPROVED_VISUAL_PASS (${results.length} checks)`);
} finally { await browser.close(); }
