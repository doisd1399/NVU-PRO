import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { build } from "esbuild";

// Actual profile, cache, history and navigation stack; remote adapters are fixtures.
const root = process.cwd();
const output = path.resolve(process.env.NVU_PROFILE_QA_DIR || "verification/ranking-profile-sheet");
await fs.mkdir(output, { recursive: true });
let playwright;
try { playwright = await import("playwright"); }
catch { playwright = await import(pathToFileURL(path.join(process.env.CODEX_PRIMARY_RUNTIME_NODE_MODULES, "playwright/index.mjs")).href); }
const photo = name => fs.readFile(name).then(bytes => `data:image/png;base64,${bytes.toString("base64")}`);
const [logo, avatar, vehicleImage] = await Promise.all([
  photo("scripts/fixtures/ranking-approved/logo-matecom.png"),
  photo("scripts/fixtures/ranking-approved/logo-cooper.png"),
  photo("public/assets/ranking-podium/truck-gold.png"),
]);
const assets = await fs.readdir("dist/assets");
const cssFiles = ["vendor", "index", "DriverWorkspace", "ModalSelect", "RankingGlobal"]
  .flatMap(prefix => assets.filter(name => name.startsWith(prefix + "-") && name.endsWith(".css")));
const css = (await Promise.all(cssFiles.map(name => fs.readFile(path.join("dist/assets", name), "utf8")))).join("\n");
assert.ok(css.includes("nvu-profile-summary"), "Build the updated production CSS first");
const mocks = `
import {useEffect,useMemo} from "react";
const logo=${JSON.stringify(logo)},avatar=${JSON.stringify(avatar)},image=${JSON.stringify(vehicleImage)};
export const company={id:"matecom",name:"MATECOM",logoUrl:logo,simulatorId:"gto"};
export const user={id:"driver-a",name:"Thiago Caetano da Silva",companyId:"matecom",profilePhotoURL:avatar};
const vehicle={id:"truck-a",name:"Iveco S Way",simulatorId:"gto"};
const operation={id:"job-a",driverId:"driver-a",companyId:"matecom",vehicleId:"truck-a",simulatorId:"gto",status:"em_andamento"};
export function currentItem(){const s=window.__scenario;return {id:"driver-a",name:s==="long"?"Alexandermagnus Constantinopolitano Souza":user.name,logo:s==="missing"?"":avatar,companyId:company.id,companyName:company.name,val:s==="long"?9999999999.99:2486272,trips:93,currency:"BRL",...(s==="mixed"?{currencyBreakdown:[{currency:"BRL",value:2486272},{currency:"EUR",value:98765.43}]}:{})};}
export function useProfileRanking(q){const s=window.__scenario;const summary=useMemo(()=>({current:currentItem(),position:1,total:24,hasActivity:true}),[s,q.participantId,q.start.getTime(),q.end.getTime(),q.periodType]);useEffect(()=>{window.__queries.push({participant:q.participantId,scope:q.scope,simulator:q.simulatorId,periodType:q.periodType,start:q.start.toISOString(),end:q.end.toISOString()});},[q.participantId,q.scope,q.simulatorId,q.periodType,q.start.getTime(),q.end.getTime()]);return {status:s==="loading"?"loading":s==="unavailable"?"unavailable":"ready",summary};}
export function useRankingParticipantVehicle(){return {status:window.__scenario==="missing"?"unavailable":"ready",authoritative:true,operation:window.__scenario==="missing"?null:operation,vehicle:window.__scenario==="missing"?null:vehicle};}
const noop=()=>{};
export function useVehiclePhoto(identity){window.__photoIdentity=identity;return {src:window.__scenario==="missing"?null:window.__scenario==="broken"?"data:image/png;base64,broken":image,remoteStatus:window.__scenario==="missing"?"missing":"ready",remoteErrorCode:"",cacheStatus:"ready",onImageLoad:noop,onImageError:noop};}
export const writeVehiclePhotoIdentitySnapshot=noop;
`;
const intercept = new Set(["useProfileRanking.ts", "useVehiclePhoto.ts", "useRankingParticipantVehicle.ts", "vehiclePhotoIdentitySnapshot.ts"]);
const bundle = await build({
  stdin: { sourcefile: "ranking-profile-qa.tsx", resolveDir: root, loader: "tsx", contents: `
import React,{useState} from "react";import {createRoot} from "react-dom/client";
import Profile from "./src/components/RankingParticipantPremiumModal";
import {handleSafeAppBack} from "./src/lib/safeBackNavigation";
import {company,user,currentItem} from "profile-fixtures";
window.__scenario="normal";window.__queries=[];window.__closeCount=0;window.__backCount=0;window.__exitCount=0;
history.back=()=>window.__backCount++;window.__nativeBack=()=>handleSafeAppBack({canGoBack:true,exitApp:()=>window.__exitCount++});
function App(){const [open,setOpen]=useState(false),[scenario,setScenario]=useState("normal"),[period,setPeriod]=useState("Mês de Outubro"),[rank,setRank]=useState(1);
window.__scenario=scenario;window.__setScenario=setScenario;window.__setPeriod=setPeriod;window.__setRank=setRank;
return <main><div style={{position:"fixed",inset:0,padding:"60px 25px",background:"#f6f9fa",color:"#172330"}}><h1>Ranking Global</h1><p>Classificação financeira.</p><button onClick={()=>setOpen(true)}>Abrir perfil</button></div>{open&&<Profile item={currentItem()} rank={rank} rankingScope="global" simulatorId="gto" periodType="mes" periodLabel={period} start={new Date("2026-10-01T03:00:00Z")} end={new Date("2026-11-01T02:59:59.999Z")} companies={[company]} simulators={[{id:"gto",name:"GTO"}]} users={scenario==="missing"?[]:[user]} companyMembers={[]} currentUserId="viewer-a" jobs={[]} vehicles={[]} onClose={()=>{window.__closeCount++;setOpen(false);}}/>}</main>;}
createRoot(document.getElementById("root")).render(<App/>);
` },
  bundle: true, write: false, outfile: path.join(output, "fixture.js"), format: "iife", platform: "browser", jsx: "automatic", loader: { ".css": "empty" },
  define: { "process.env.NODE_ENV": '"test"', "import.meta.env.BASE_URL": '"/"' },
  plugins: [{ name: "profile-adapters", setup(plugin) {
    plugin.onResolve({ filter: /^profile-fixtures$/ }, () => ({ path: "fixtures", namespace: "profile-fixture" }));
    plugin.onLoad({ filter: /.*/, namespace: "profile-fixture" }, () => ({ contents: mocks, resolveDir: root, loader: "tsx" }));
    plugin.onLoad({ filter: /src\/.*\.tsx?$/ }, args => intercept.has(path.basename(args.path)) ? { contents: 'export * from "profile-fixtures";', resolveDir: root, loader: "tsx" } : undefined);
  } }],
});
const js = bundle.outputFiles.find(file => file.path.endsWith(".js")).text;
const html = `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>${css}</style></head><body><div id="root"></div><script>${js.replace(/<\/script/gi,"<\\/script")}</script></body></html>`;
await fs.writeFile(path.join(output, "fixture.html"), html);
const browser = await playwright.chromium.launch({ headless: true, ...(process.env.NVU_CHROMIUM_EXECUTABLE ? { executablePath: process.env.NVU_CHROMIUM_EXECUTABLE } : {}), args: ["--no-sandbox", "--disable-dev-shm-usage"] });
const context = await browser.newContext({ viewport: { width: 390, height: 867 }, deviceScaleFactor: 2, reducedMotion: "reduce" });
const errors = [], external = [], results = [];
await context.route("**/*", async route => {
  const url = new URL(route.request().url());
  if (url.hostname !== "127.0.0.1") { external.push(url.href); return route.abort(); }
  if (url.pathname.startsWith("/assets/")) {
    return route.fulfill({ body: await fs.readFile(path.join(root, "public", url.pathname)), contentType: url.pathname.endsWith("woff2") ? "font/woff2" : "image/png" });
  }
  return route.fulfill({ body: html, contentType: "text/html" });
});
const page = await context.newPage();
page.on("pageerror", error => errors.push(error.message));
const dialog = () => page.getByRole("dialog", { name: "Perfil do motorista" });
const history = () => dialog().getByRole("button", { name: "Histórico de classificações", exact: true });
async function check(name, run) { await run(); results.push({ name, pass: true }); console.log("PASS " + name); }
async function open() { await page.getByRole("button", { name: "Abrir perfil", exact: true }).click(); await dialog().waitFor(); await page.evaluate(() => document.fonts.ready); }
async function close() { await dialog().getByRole("button", { name: "Fechar participante" }).click(); await dialog().waitFor({ state: "hidden" }); }
try {
  await page.goto("http://127.0.0.1:43822/");
  await open();
  await check("Approved content, period, identity and company/results share one card", async () => {
    const text = (await dialog().innerText()).replace(/\s+/g, " ");
    for (const value of ["Thiago Caetano", "1º", "Ranking global", "Mês de Outubro", "R$ 2.486.272,00", "Viagens", "93", "Empresa atual", "Matecom", "Histórico de classificações"]) assert.ok(text.includes(value), text);
    assert.ok(!text.includes("GTO") && !text.includes("Ganhos no ranking"));
    assert.equal(await page.getByTestId("ranking-profile-summary").getByTestId("ranking-profile-company").count(), 1);
    assert.equal(await dialog().locator(".nvu-profile-history-row").count(), 0);
    const name = await dialog().locator(".nvu-profile-person h3").boundingBox();
    const rank = await dialog().locator(".nvu-profile-position").boundingBox();
    const scope = await dialog().locator(".nvu-profile-scope").boundingBox();
    assert.ok(rank.y >= name.y + name.height && rank.x + rank.width <= scope.x);
    assert.equal(await page.evaluate(() => window.__queries.length), 1, "History reads are deferred until expansion");
    const identity = await page.evaluate(() => window.__photoIdentity);
    assert.equal(identity.userId, "driver-a"); assert.equal(identity.vehicleId, "truck-a"); assert.equal(identity.simulatorId, "gto");
  });
  for (const width of [320, 360, 390, 412, 768]) for (const theme of ["light", "dark"]) {
    await page.setViewportSize({ width, height: Math.round(width * 2.22) });
    await page.evaluate(value => document.documentElement.className = value === "dark" ? "dark" : "", theme);
    await page.waitForFunction(value => [".nvu-ranking-profile-modal", ".nvu-profile-trip-count > span"].every(selector => getComputedStyle(document.querySelector(selector)).color === (value === "dark" ? "rgb(243, 247, 249)" : "rgb(23, 35, 48)")), theme);
    await check(`Bottom anchoring, header spacing and compact layout: ${width}px / ${theme}`, async () => {
      const g = await dialog().evaluate(node => {
        const rect = n => { const r = n.getBoundingClientRect(); return { top:r.top, bottom:r.bottom, left:r.left, right:r.right, width:r.width, height:r.height }; };
        const overlay = node.parentElement;
        return { viewport: { width:innerWidth,height:innerHeight },sheet:rect(node),title:rect(node.querySelector(".nvu-profile-header h2")),header:rect(node.querySelector("header")),cover:rect(node.querySelector(".nvu-profile-cover")),
          style:{panel:getComputedStyle(node).color,opacity:getComputedStyle(overlay).backgroundColor,animation:getComputedStyle(node).animationName},
          overflow:node.scrollWidth>node.clientWidth,amounts:[...node.querySelectorAll(".nvu-profile-money-line")].map(n=>({client:n.clientWidth,scroll:n.scrollWidth})),
          close:rect(node.querySelector(".nvu-profile-close")),x:rect(node.querySelector(".nvu-profile-close svg")) };
      });
      assert.ok(Math.abs(g.sheet.bottom-g.viewport.height)<1, JSON.stringify(g));
      assert.ok(g.sheet.top >= 0 && g.sheet.height <= g.viewport.height*.92+1);
      if(width<=520) assert.ok(Math.abs(g.sheet.width-width)<1);
      assert.equal(g.overflow,false);
      assert.ok(g.amounts.every(n=>n.scroll<=n.client+1),JSON.stringify(g.amounts));
      assert.ok(g.title.top-g.header.top>=24 && g.cover.top-g.title.bottom>=16,JSON.stringify(g));
      assert.ok(g.close.width>=36 && g.x.width<=17);
      assert.match(g.style.opacity,theme==="dark"?/0\.64/:/0\.86/); assert.equal(g.style.animation,"none");
      assert.equal(g.style.panel,theme==="dark"?"rgb(243, 247, 249)":"rgb(23, 35, 48)");
      if(width===390) await page.screenshot({path:path.join(output,`profile-${theme}-390.png`)});
    });
  }
  await page.setViewportSize({width:390,height:867});
  await check("Nonwinning positions use their metal and omit the crown", async () => {
    for (const [rank,metal] of [[2,"silver"],[3,"bronze"],[4,"neutral"]]) {
      await page.evaluate(value => window.__setRank(value),rank);
      await page.waitForFunction(value => document.querySelector(".nvu-profile-position").getAttribute("aria-label") === `${value}º lugar`,rank);
      assert.equal(await dialog().locator(`.nvu-profile-position.nvu-metal-${metal}`).count(),1);
      assert.equal(await dialog().locator(".nvu-profile-position .nvu-gamer-crown").count(),0);
    }
    await page.evaluate(()=>window.__setRank(1));
    await page.waitForFunction(()=>document.querySelector(".nvu-profile-position .nvu-gamer-crown"));
  });
  await check("History pagination, independent weekly/monthly counts and correct query scope", async () => {
    await history().click();
    assert.equal(await dialog().locator(".nvu-profile-history-row").count(),5);
    await dialog().getByRole("button",{name:"Ver mais 5 classificações"}).click();
    assert.equal(await dialog().locator(".nvu-profile-history-row").count(),10);
    await dialog().getByRole("button",{name:"Semanal (5)",exact:true}).click();
    assert.equal(await dialog().locator(".nvu-profile-history-row").count(),5);
    await dialog().getByRole("button",{name:"Mensal (10)",exact:true}).click();
    assert.equal(await dialog().locator(".nvu-profile-history-row").count(),10);
    await dialog().getByRole("button",{name:"Ver mais 5 classificações"}).click();
    await dialog().getByRole("button",{name:"Ver mais 5 classificações"}).click();
    assert.equal(await dialog().locator(".nvu-profile-history-row").count(),20);
    assert.equal(await dialog().getByRole("button",{name:"Ver mais 5 classificações"}).count(),0);
    const queries=await page.evaluate(()=>window.__queries);
    assert.ok(queries.every(q=>q.participant==="driver-a"&&q.scope==="global"&&q.simulator==="gto"));
    assert.ok(queries.some(q=>q.periodType==="semana"));
    const header=await dialog().locator("header").boundingBox();assert.ok(header.y>=0,"Header remains accessible while history scrolls");
    await history().click();
  });
  await check("Period label follows the applied filter without a simulator label",async()=>{
    await page.evaluate(()=>window.__setPeriod("18/10/2026 até 20/10/2026"));
    await page.waitForFunction(()=>document.querySelector('[data-testid="ranking-profile-period"]').textContent==="18/10/2026 até 20/10/2026");
    assert.equal(await page.getByTestId("ranking-profile-period").innerText(),"18/10/2026 até 20/10/2026");
    await page.evaluate(()=>window.__setPeriod("Mês de Outubro"));
    await page.waitForFunction(()=>document.querySelector('[data-testid="ranking-profile-period"]').textContent==="Mês de Outubro");
  });
  await check("Keyboard trap, restore focus, backdrop and native Back close exactly once",async()=>{
    await dialog().focus();await page.keyboard.press("Tab");
    assert.equal(await dialog().getByRole("button",{name:"Fechar participante"}).evaluate(n=>n===document.activeElement),true);
    await page.keyboard.press("Shift+Tab");assert.equal(await history().evaluate(n=>n===document.activeElement),true);
    await page.keyboard.press("Escape");assert.equal(await dialog().count(),0);
    assert.equal(await page.getByRole("button",{name:"Abrir perfil",exact:true}).evaluate(n=>n===document.activeElement),true);
    await open();await dialog().locator(".nvu-profile-cover").click();assert.equal(await dialog().count(),1);
    await page.locator(".nvu-ranking-profile-overlay").click({position:{x:2,y:2}});assert.equal(await dialog().count(),0);
    await open();const before=await page.evaluate(()=>window.__closeCount);
    await page.evaluate(()=>window.__nativeBack());assert.equal(await dialog().count(),0);
    assert.equal(await page.evaluate(()=>window.__closeCount),before+1);
    assert.equal(await page.evaluate(()=>window.__backCount),0);assert.equal(await page.evaluate(()=>window.__exitCount),0);
  });
  for(const scenario of ["long","mixed","missing","broken","loading","unavailable"]){
    await page.setViewportSize({width:320,height:710});
    await page.evaluate(s=>window.__setScenario(s),scenario);await open();
    await check(`320px profile state: ${scenario}`,async()=>{
      if(scenario==="broken")await dialog().locator(".nvu-profile-cover-fallback").waitFor();
      const g=await dialog().evaluate(n=>({width:n.clientWidth,scroll:n.scrollWidth,amounts:[...n.querySelectorAll(".nvu-profile-money-line")].map(x=>({width:x.clientWidth,scroll:x.scrollWidth}))}));
      assert.ok(g.scroll<=g.width,JSON.stringify(g));assert.ok(g.amounts.every(x=>x.scroll<=x.width+1),JSON.stringify(g));
      if(scenario==="mixed"){assert.equal(await dialog().locator(".nvu-profile-results .nvu-profile-money-line").count(),2);assert.match(await dialog().innerText(),/98\.765,43/);}
      if(scenario==="missing")assert.match(await dialog().locator(".nvu-profile-cover-fallback").innerText(),/Foto não Adicionada/);
      if(scenario==="loading")assert.match(await dialog().innerText(),/2\.486\.272,00/,"Already-known ranking values do not wait for a remote query");
    });await close();
  }
  await check("Offline snapshot remains readable and shows local status",async()=>{
    await page.evaluate(()=>{window.__setScenario("normal");Object.defineProperty(navigator,"onLine",{configurable:true,value:false});});
    await open();assert.match(await dialog().innerText(),/Última versão salva no aparelho/);assert.match(await dialog().innerText(),/2\.486\.272,00/);await close();
  });
  await check("Low landscape viewport keeps close action visible and content scrollable",async()=>{
    await page.setViewportSize({width:640,height:360});await open();await history().click();
    const g=await dialog().evaluate(n=>({bottom:n.getBoundingClientRect().bottom,header:n.querySelector("header").getBoundingClientRect().top,body:n.querySelector(".nvu-profile-content").clientHeight,scroll:n.querySelector(".nvu-profile-content").scrollHeight}));
    assert.equal(g.bottom,360);assert.ok(g.header>=0);assert.ok(g.scroll>g.body);await close();
  });
  assert.deepEqual(errors,[]);assert.deepEqual(external,[]);
  await fs.writeFile(path.join(output,"results.json"),JSON.stringify({pass:true,checks:results.length,results,errors,externalRequests:external,limitations:["Remote ranking and vehicle-photo adapters are isolated fixtures; no production data was accessed.","The real component, compiled production CSS, local fonts, cache and native Back routing logic were exercised in Chromium; a physical Android device was not used."]},null,2));
  console.log(`RANKING_PROFILE_SHEET_UI_PASS (${results.length} checks)`);
}finally{await browser.close();}
