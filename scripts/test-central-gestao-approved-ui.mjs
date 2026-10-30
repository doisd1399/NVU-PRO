import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { build } from "esbuild";

// Real AdminLayout -> Fleet -> OperationsTab -> management components and built
// production CSS. Only session/remote adapters and secondary pages are fixtures.
const root = process.cwd();
const audit489 = process.env.NVU_AUDIT_489_UI === "true";
const output = path.resolve(process.env.NVU_CENTRAL_QA_DIR || "verification/central-management");
await fs.mkdir(output, { recursive: true });
let playwright;
try { playwright = await import("playwright"); }
catch { playwright = await import(pathToFileURL(path.join(process.env.CODEX_PRIMARY_RUNTIME_NODE_MODULES, "playwright/index.mjs")).href); }
const photo = `data:image/jpeg;base64,${(await fs.readFile("scripts/fixtures/central-management/vehicle.jpg")).toString("base64")}`;
const avatar = `data:image/png;base64,${(await fs.readFile("scripts/fixtures/central-management/avatar.png")).toString("base64")}`;
const assets = await fs.readdir("dist/assets");
const cssFiles = ["vendor", "index", "DriverWorkspace", "ProfileCoverHero", "ModalSelect", "RankingPeriodModal", "OperationsTab"]
  .flatMap(prefix => assets.filter(name => name.startsWith(prefix + "-") && name.endsWith(".css")));
assert.equal(cssFiles.length, 7, "Build the app before running the UI check");
const css = (await Promise.all(cssFiles.map(name => fs.readFile(path.join("dist/assets", name), "utf8")))).join("\n");
const fixtures = `
import React,{useSyncExternalStore} from "react";
const photo=${JSON.stringify(photo)},avatar=${JSON.stringify(avatar)};
const noop=()=>{},load=async()=>{},empty=[];
const simulators=[{id:"gto",name:"GTO"}];
const companies=[{id:"dc",companyName:"DC Transportes",ownerId:"driver",userId:"driver",simulatorId:"gto",simulator:"GTO",status:"active"},{id:"other",companyName:"Outra Empresa",ownerId:"driver",simulatorId:"gto",status:"active"}];
const users=[{id:"driver",name:"David Canto",profilePhotoURL:avatar,isOnline:true,status:"active",roles:["admin","driver"]}];
const memberships=companies.map(c=>({id:c.id,userId:"driver",companyId:c.id,roles:["admin","driver"],status:"active"}));
const contracts=[{id:"bls",companyId:"dc",name:"BLS - 140",simulatorId:"gto",simulator:"GTO",totalDeliveries:10,deadlineDays:7,mode:"simple"}];
const vehicles=[{id:"iveco",companyId:"dc",name:"Iveco S Way",paintCode:"https://example.com/pintura",status:"in_use"},...${audit489 ? 15 : 0}?Array.from({length:${audit489 ? 15 : 0}},(_,i)=>({id:"v"+i,companyId:"dc",name:"Veículo "+i,status:"available"})):[]];
const trailers=[{id:"trailer",companyId:"dc",name:"Rodocaçamba 6 eixos",paintCode:"NVU-2026",status:"in_use"}];
const jobs=[{id:"operation",operationId:"operation",companyId:"dc",driverId:"driver",vehicleId:"iveco",trailerId:"trailer",contractId:"bls",simulatorId:"gto",status:"active",progress:99,assignedAt:"2026-10-15T10:00:00Z",dueAt:"2026-10-22T12:49:00Z",totalDeliveries:10}];
const manyUsers=["Lucas Almeida","Mariana Souza","Rafael Costa","Beatriz Lima","Gustavo Rocha","Camila Duarte","Thiago Martins"].map((name,i)=>({id:"drv"+i,name,profilePhotoURL:avatar,isOnline:true,status:"active",roles:["driver"]}));
const manyJobs=manyUsers.map((user,i)=>({id:"many"+i,operationId:"many"+i,companyId:"dc",driverId:user.id,vehicleId:"iveco",trailerId:"trailer",contractId:"bls",simulatorId:"gto",status:"active",assignedAt:"2026-10-15T10:00:00Z",dueAt:"2026-10-2"+(i%5+2)+"T12:49:00Z",totalDeliveries:10}));
const trips=Array.from({length:5},(_,i)=>({id:"trip-"+i,jobId:i<3?"operation":"previous",driverId:"driver",companyId:"dc",contractId:"bls",simulatorId:"gto",simulator:"GTO",status:"completed",recordStatus:"completed",serverValidatedAt:"2026-10-19T12:00:00Z",completedAt:"2026-10-19T12:00:00Z",valorCents:[3000000,3000000,3000000,3000000,2168200][i],currency:"BRL",currencyStatus:"known"}));
let revision=0;const listeners=new Set(),goalListeners=new Set();
const state={activeCompanyId:"dc",empty:false,missing:false,denied:false,authorized:true,mixed:false,late:false,many:false};
window.__fixtureState=state;window.__writes=[];window.__cancels=[];window.__photos=[];window.__goalManagedCalls=0;window.__goalSubscriptions=0;window.__goalReadStarts=0;window.__fleetMounts=0;window.__roleRequests=[];
const publish=()=>{revision++;listeners.forEach(f=>f());};
window.__scenario=(next)=>{Object.assign(state,next);publish();};
window.__goalError=(denied)=>{state.denied=denied;goalListeners.forEach(f=>f());};
function subscribe(fn){listeners.add(fn);return()=>listeners.delete(fn);}
function useFixture(){useSyncExternalStore(subscribe,()=>revision);}
export function useSessionStore(){useFixture();return {currentUser:state.authorized?users[0]:{...users[0],id:"viewer"},activeRole:"admin",switchRole:async role=>{window.__roleRequests.push(role);},logOutApp:load,setSeniorCompanyId:noop};}
export function useCompanyStore(){useFixture();return {activeCompanyId:state.activeCompanyId,setActiveCompanyId:id=>window.__scenario({activeCompanyId:id}),companies,allCompanies:companies,memberships,allCompanyMembers:memberships,allCompanyMembersReady:true,recruitmentApplications:empty};}
export function useOperationalStore(){useFixture();return {sequences:empty,addVehicle:load,updateVehicle:load,deleteVehicle:load,createSequence:load,updateSequence:load,deleteSequence:load,users:state.many?[...users,...manyUsers]:users,contracts,jobs:(!navigator.onLine||state.empty)?empty:state.late?[{...jobs[0],dueAt:"2026-10-18T12:00:00Z"}]:state.many?[...jobs,...manyJobs]:jobs,vehicles,trailers,simulators,cancelJob:async id=>{window.__cancels.push(id);window.__scenario({empty:true});},rejectJobDemand:load,operationalDataReady:navigator.onLine,operationalDataRefreshing:false};}
export function useActivityStore(){return {jobDemands:empty};}
export function useNotificationStore(){return {notifications:empty,markNotificationAsRead:load};}
const mixed=[...trips,{...trips[4],id:"eur",currency:"EUR",valorCents:9999900}];
export function useTripHistory(){useFixture();return {historicoTrips:navigator.onLine?(state.mixed?mixed:trips):empty,loading:!navigator.onLine};}
export function useVehiclePhoto(identity){useFixture();if(identity)window.__photos.push(identity);return {src:state.missing?"":photo};}
export function useProfileCover(){return {src:"",pending:false,failed:false,retry:()=>{}};}
export function usePersistentRankingImage(src){return {src,onLoad:noop,onError:noop};}
const tokenListeners=new Set();
export const auth={currentUser:{uid:"driver",getIdToken:async()=>"fixture-token"}},db={},storage={},functions={};
export function onIdTokenChanged(auth,fn){tokenListeners.add(fn);queueMicrotask(()=>fn(auth.currentUser));return()=>tokenListeners.delete(fn);}
window.__goalAuth=(ready)=>{auth.currentUser=ready?{uid:"driver",getIdToken:async()=>"fixture-token"}:null;tokenListeners.forEach(fn=>fn(auth.currentUser));};
export const preloadRoute=load,preloadFleetPanel=load,warmRegisteredRankingPhotos=load,waitForRankingWarmup=load,beginRankingWarmupSession=noop;
export function CompactProfileEditorModal({open,onClose}){return open?<div role="dialog"><button onClick={onClose}>Fechar perfil</button></div>:null;}
export function GlobalMenu({open,onClose,onSwitchRole}){window.__switchFromMenu=onSwitchRole;return open?<div data-testid="shell-menu"><button onClick={onClose}>Fechar menu</button></div>:null;}
export function doc(db,collection,id){return {collection,id};}
export function serverTimestamp(){return "SERVER_TIMESTAMP";}
export function onSnapshot(ref,options,next,error){if(typeof options==="function"){error=next;next=options;}window.__goalSubscriptions++;window.__goalReadStarts++;let alive=true;const emit=()=>{if(!alive)return;if(!navigator.onLine){next({metadata:{fromCache:true},exists:()=>false,data:()=>undefined});return;}if(state.denied||!auth.currentUser)error({code:"permission-denied"});else next({metadata:{fromCache:false},exists:()=>true,data:()=>({targetAmount:ref.id.startsWith("other__")?500000:200000})});};goalListeners.add(emit);queueMicrotask(emit);return()=>{alive=false;goalListeners.delete(emit);window.__goalSubscriptions--;};}
export async function setDoc(ref,data,options){window.__writes.push({ref,data,options});}
export function AvailableVehiclesButton(){return <button>Veículos disponíveis</button>;}
export async function accessManagedGoal(scope,documentId,amount){window.__goalManagedCalls++;if(state.denied)throw {code:"functions/permission-denied"};return {companyId:scope.companyId,simulatorId:scope.simulatorId,targetAmount:amount??200000,periodKey:"range:2026-10-01:2026-10-31",exists:true};}
export default function Secondary(){return <div data-testid="secondary-page">Ferramenta da empresa</div>;}
`;
const adapters = new Set(["AppContext.tsx", "CompanyContext.tsx", "NotificationsContext.tsx", "useTripHistory.ts", "useVehiclePhoto.ts", "usePersistentRankingImage.ts", "useProfileCover.ts", "firebase.ts", "routePreload.ts", "rankingPhotoWarmup.ts", "CompactProfileEditorModal.tsx", "GlobalMenu.tsx", "operationalGoalAccess.ts", "OperationalQueuesManager.tsx"]);
const secondary = new Set(["CompanyTab.tsx", "VehiclesTab.tsx", "TrailersTab.tsx", "DriversTab.tsx", "ContractsTab.tsx", "RecruitmentTab.tsx", "TripHistory.tsx", "Reports.tsx"]);
if(audit489) secondary.delete("VehiclesTab.tsx");
const bundle = await build({
  stdin: { resolveDir: root, sourcefile: "central-ui-qa.tsx", loader: "tsx", contents: `
import React from "react";import {createRoot} from "react-dom/client";import {MemoryRouter,Routes,Route,useLocation,useNavigate} from "react-router-dom";
import AdminLayout from "./src/layouts/AdminLayout";import Fleet from "./src/pages/admin/Fleet";import {WorkspaceSwipeNavigation} from "./src/components/WorkspaceSwipeNavigation";import {WorkspaceScrollMemory} from "./src/components/common/WorkspaceScrollMemory";
function TrackedFleet(){React.useState(()=>++window.__fleetMounts);return <Fleet/>;}
function Probe(){const location=useLocation(),navigate=useNavigate();window.__route={pathname:location.pathname,state:location.state};window.__go=navigate;return null;}
createRoot(document.getElementById("root")).render(<MemoryRouter initialEntries={[{pathname:"/admin/fleet",state:{activeTab:"operations"}}]}><Probe/><WorkspaceScrollMemory scope="qa:driver:dc"/><WorkspaceSwipeNavigation/><Routes><Route path="/admin" element={<AdminLayout/>}><Route path="fleet" element={<TrackedFleet/>}/><Route path="*" element={<div>Destino</div>}/></Route><Route path="*" element={<div>Outra página</div>}/></Routes></MemoryRouter>);
` }, bundle: true, write: false, outfile: path.join(output, "fixture.js"), format: "iife", platform: "browser", jsx: "automatic", loader: { ".css": "empty" },
  define: { "process.env.NODE_ENV": '"test"', "import.meta.env.BASE_URL": '"/"', "import.meta.env.PROD": "false" },
  plugins: [{ name: "central-remote-adapters", setup(plugin) {
    plugin.onResolve({ filter: /^central-fixtures$/ }, () => ({ path: "fixtures", namespace: "central-fixture" }));
    plugin.onLoad({ filter: /.*/, namespace: "central-fixture" }, () => ({ contents: fixtures, resolveDir: root, loader: "tsx" }));
    plugin.onResolve({ filter: /^firebase\/(firestore|auth)$/ }, args => /\/(OperationsTab|useOperationalGoal)\.tsx?$/.test(args.importer) ? { path: "fixtures", namespace: "central-fixture" } : undefined);
    plugin.onLoad({ filter: /src\/.*\.tsx?$/ }, args => adapters.has(path.basename(args.path)) || secondary.has(path.basename(args.path)) ? { contents: 'export * from "central-fixtures";export {default} from "central-fixtures";', resolveDir: root, loader: "tsx" } : undefined);
  } }],
});
const js = bundle.outputFiles.find(file => file.path.endsWith(".js")).text;
const html = `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>${css}</style></head><body><div id="root"></div><script>${js.replace(/<\/script/gi, "<\\/script")}</script></body></html>`;
const browser = await playwright.chromium.launch({ headless: true, ...(process.env.NVU_CHROMIUM_EXECUTABLE ? { executablePath: process.env.NVU_CHROMIUM_EXECUTABLE } : {}), args: ["--no-sandbox", "--disable-dev-shm-usage"] });
const context = await browser.newContext({ viewport: { width: 390, height: 867 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, timezoneId: "America/Sao_Paulo" });
const errors = [], outbound = [], results = [];
await context.addInitScript(() => {
  if(localStorage.getItem("__qa-offline")==="true")Object.defineProperty(navigator,"onLine",{value:false,configurable:true});
  const RealDate = Date, fixed = new RealDate("2026-10-20T09:06:00Z").getTime();
  window.Date = class extends RealDate { constructor(...args) { super(...(args.length ? args : [fixed])); } static now() { return fixed; } };
});
await context.route("**/*", async route => {
  const url = new URL(route.request().url());
  if (url.hostname !== "127.0.0.1") { outbound.push(url.href); return route.abort(); }
  if (url.pathname.endsWith(".woff2")) return route.fulfill({contentType:"font/woff2",body:await fs.readFile(path.join(root,"public",url.pathname))});
  return route.fulfill({ contentType: "text/html", body: html });
});
const page = await context.newPage();
page.on("pageerror", error => errors.push(error.message));
async function check(name, run) { await run(); results.push({ name, pass: true }); console.log("PASS " + name); }
async function ready() {
  await page.getByTestId("management-dashboard").waitFor(); await page.evaluate(() => document.fonts.ready);
  await page.waitForFunction(() => [...document.querySelectorAll('.nvu-admin-header img,.nvu-central-avatar img,.nvu-central-photo-frame img')].every(image => image.complete && image.naturalWidth > 0));
}
async function fresh(reset = true) {
  if (reset && page.url().startsWith("http://127.0.0.1")) await page.evaluate(() => {sessionStorage.clear();localStorage.clear();});
  await page.goto("http://127.0.0.1:43828/"); await ready();
}
try {
  await fresh();
  await check("Actual shell: heading below header, theme-aware bell, independent central classes", async () => {
    const geometry = await page.evaluate(() => {
      const h=document.querySelector(".nvu-admin-header"),title=document.querySelector(".nvu-central-intro");
      return {header:h.getBoundingClientRect().bottom,title:title.getBoundingClientRect().top,bell:getComputedStyle(h.querySelector(".nvu-notification-trigger svg")).color};
    });
    assert.ok(geometry.title >= geometry.header, JSON.stringify(geometry));
    assert.notEqual(geometry.bell, "rgb(255, 255, 255)");
    assert.equal(await page.locator(".nvu-central-shell.nvu-native-admin-company-route,.nvu-central-shell .nvu-admin-company-page,.nvu-central-shell [data-nvu-hero-chrome]").count(),0);
    assert.equal(await page.getByRole("heading",{name:"Central de gestão",exact:true}).count(),1);
    const wordmark=await page.locator('.nvu-admin-header .nvu-wordmark:visible').evaluate(n=>{const s=getComputedStyle(n);return [s.fontSize,s.fontWeight,s.letterSpacing];});
    assert.deepEqual(wordmark,["18px","700","-0.45px"]);
  });
  await check("Real confirmed receipts and identity-scoped vehicle photo", async () => {
    assert.match(await page.locator(".nvu-central-earnings").innerText(),/141.682,00/);
    assert.equal(await page.locator(".nvu-central-trip-count").innerText(),"5");
    assert.equal(await page.locator(".nvu-central-operation-metrics strong").first().innerText(),"3/10");
    assert.match(await page.locator(".nvu-central-operation-timing").innerText(),/22\/10\/2026/);
    assert.ok(await page.evaluate(()=>window.__photos.some(p=>p.userId==="driver"&&p.simulatorId==="gto"&&p.vehicleId==="iveco")));
    assert.equal(await page.getByRole("progressbar",{name:"Progresso de David Canto"}).getAttribute("aria-valuenow"),"30");
    assert.equal(await page.getByRole("button",{name:"Gerenciar empresa",exact:true}).count(),0);
  });
  await check("A rapid return to the visible profile cancels an earlier pending role choice",async()=>{
    await page.evaluate(()=>{const choose=window.__switchFromMenu;choose('driver');choose('admin');});
    await ready();assert.deepEqual(await page.evaluate(()=>window.__roleRequests),['driver','admin']);
    assert.equal((await page.evaluate(()=>window.__route)).pathname,'/admin/fleet');
  });
  // Inspect screenshots locally; these are internal QA, not user deliverables.
  for (const width of [320,360,390,412,768,1280]) for (const theme of ["light","dark"]) {
    await page.setViewportSize({width,height:Math.round(width*1536/691)});
    await page.evaluate(value=>window.dispatchEvent(new CustomEvent("nvu:theme-change",{detail:value})),theme);
    await check(`Geometry and contrast: ${width}px / ${theme}`,async()=>{
      const data=await page.evaluate(()=>({width:innerWidth,scroll:document.documentElement.scrollWidth,card:getComputedStyle(document.querySelector(".nvu-central-section")).backgroundColor,text:getComputedStyle(document.querySelector(".nvu-central-section")).color,page:getComputedStyle(document.querySelector(".nvu-central-page")).backgroundColor,body:getComputedStyle(document.body).backgroundColor,dock:getComputedStyle(document.querySelector(".nvu-driver-dock")).backgroundColor}));
      assert.ok(data.scroll<=data.width,JSON.stringify(data));assert.notEqual(data.card,data.text);assert.equal(data.page,data.body);assert.notEqual(data.dock,data.page);
      if(theme==="light") {
        const rgb=value=>value.match(/\d+/g).slice(0,3).map(Number);
        assert(rgb(data.page).reduce((n,v,i)=>n+Math.abs(v-rgb(data.dock)[i]),0)>=30,"Light dock and page need a perceptible separation");
      }
      await page.evaluate(()=>window.scrollTo(0,document.documentElement.scrollHeight));
      const clearance=await page.evaluate(()=>({last:[...document.querySelectorAll('.nvu-central-section')].filter(n=>n.getClientRects().length).at(-1).getBoundingClientRect().bottom,dock:document.querySelector('.nvu-driver-dock').getBoundingClientRect().top,spacer:document.querySelector('.nvu-workspace-dock-space').getBoundingClientRect().height}));
      assert(clearance.spacer>=62&&clearance.last<=clearance.dock-5.5,JSON.stringify(clearance));
      await page.evaluate(()=>window.scrollTo(0,0));
      const centered=await page.locator(".nvu-workspace-page-title > p").evaluate(p=>{const a=p.getBoundingClientRect(),b=p.parentElement.getBoundingClientRect();return Math.abs((a.left+a.right-b.left-b.right)/2)<1&&getComputedStyle(p).textAlign==="center";});assert(centered,"The description card itself and its text must be centered");
    });
    if(width===390) {
      await page.screenshot({path:path.join(output,`central-work-${theme}.png`),fullPage:true,animations:"disabled"});
      await page.getByRole("button",{name:/Trabalhos ativos/}).click();
      await page.screenshot({path:path.join(output,`central-actions-${theme}.png`),fullPage:true,animations:"disabled"});
      await page.getByRole("button",{name:/Trabalhos ativos/}).click();
    }
  }
  await page.setViewportSize({width:390,height:867});
  await check("Company overdue and remaining-time text share the driver's orange in both themes",async()=>{
    for(const theme of ["light","dark"]){
      await page.evaluate(theme=>{window.dispatchEvent(new CustomEvent("nvu:theme-change",{detail:theme}));window.__scenario({late:true});},theme);
      await page.locator('.nvu-central-job-status[data-state="overdue"]').waitFor();
      const colors=await page.evaluate(()=>{
        const warning=document.querySelector('.nvu-central-operation-timing strong[data-warning="true"]'),status=document.querySelector('.nvu-central-job-status[data-state="overdue"]');
        return {warning:getComputedStyle(warning).color,status:getComputedStyle(status).color,shared:getComputedStyle(document.documentElement).getPropertyValue('--nvu-operation-warning').trim()};
      });
      assert.equal(colors.warning,theme==="dark"?"rgb(255, 136, 0)":"rgb(184, 102, 13)");assert.equal(colors.status,colors.warning);
      const shared=colors.shared.length===4?'#'+[...colors.shared.slice(1)].map(c=>c+c).join(''):colors.shared;
      assert.equal(shared,theme==="dark"?"#ff8800":"#b8660d");
    }
    await page.evaluate(()=>window.__scenario({late:false}));
  });
  await check("Summary and management stay expanded; old filter and cyan action removed",async()=>{
    assert.equal(await page.locator(".nvu-central-action").count(),6);
    assert.equal(await page.getByRole("button",{name:/Resumo operacional|Gerenciar empresa/}).count(),0);
    assert.equal(await page.getByRole("button",{name:"Filtrar trabalhos ativos"}).count(),0);
    assert.equal(await page.getByText("Ganhos, viagens e metas",{exact:true}).count(),0);
    const actions=await page.locator(".nvu-central-action").evaluateAll(nodes=>nodes.map(n=>({color:getComputedStyle(n).color,background:getComputedStyle(n).backgroundColor})));
    assert.deepEqual(actions[1],actions[0]);
    const align=await page.locator(".nvu-workspace-page-heading h1").evaluate(n=>getComputedStyle(n).textAlign);assert.equal(align,"center");
  });
  await check("Information modal, paints modal, Escape and focus restore",async()=>{
    const info=page.getByRole("button",{name:"Ver informações de Iveco S Way"});await info.click();
    const dialog=page.getByRole("dialog",{name:"Informações da operação"});await dialog.waitFor();
    assert.match(await dialog.innerText(),/DC Transportes/);assert.match(await dialog.innerText(),/BLS - 140/);
    await page.keyboard.press("Escape");assert.equal(await page.getByRole("dialog").count(),0);
    assert.ok(await info.evaluate(n=>n===document.activeElement));
    await page.getByRole("button",{name:"Ver pinturas de Iveco S Way"}).click();
    const paints=page.getByRole("dialog",{name:"Pinturas disponíveis"});await paints.waitFor();
    assert.equal(await paints.getByRole("link",{name:"Abrir pintura"}).getAttribute("href"),"https://example.com/pintura");
    assert.match(await paints.innerText(),/NVU-2026/);await page.keyboard.press("Escape");
  });
  await check("Calendar drafts, apply, custom range and persisted company period",async()=>{
    const open=()=>page.getByRole("button",{name:/Escolher período:/}).click();
    await open();await page.getByRole("button",{name:"Semana atual",exact:true}).click();
    await page.keyboard.press("Escape");assert.match(await page.locator(".nvu-central-period").innerText(),/Outubro 2026/i);
    await open();await page.getByRole("button",{name:"Semana atual",exact:true}).click();await page.getByRole("button",{name:"Aplicar filtro"}).click();
    assert.match(await page.locator(".nvu-central-period").innerText(),/Semana atual/);
    await open();
    const dialog=page.getByRole("dialog",{name:"Filtrar por período"});
    await dialog.locator('[data-day="2026-10-10"]:not([data-outside]) button').click();
    await dialog.locator('[data-day="2026-10-15"]:not([data-outside]) button').click();
    await dialog.getByRole("button",{name:"Aplicar filtro"}).click();
    assert.match(await page.locator(".nvu-central-period").innerText(),/10\/10.*15\/10/);
    assert.equal(await page.evaluate(()=>JSON.parse(localStorage.getItem("nvu-central-period:driver:dc")).period),"personalizado");
    assert.equal(await page.evaluate(()=>window.__goalSubscriptions),1);
  });
  await fresh();
  await check("Goal edit writes company/simulator/period, invalid amounts stay local",async()=>{
    await page.getByRole("button",{name:"Ajustar meta financeira"}).click();
    const dialog=page.getByRole("dialog",{name:"Ajustar meta financeira"});assert.equal(await dialog.getByRole("textbox").inputValue(),"200.000,00");await dialog.getByRole("textbox").fill("0");await dialog.getByRole("button",{name:"Salvar meta"}).click();
    assert.equal(await page.evaluate(()=>window.__writes.length),0);await dialog.getByRole("textbox").fill("250.000,00");await dialog.getByRole("button",{name:"Salvar meta"}).click();
    const writes=await page.evaluate(()=>window.__writes);assert.equal(writes.length,1);assert.equal(writes[0].data.targetAmount,250000);assert.equal(writes[0].data.companyId,"dc");assert.equal(writes[0].data.currency,"BRL");
    assert.equal(writes[0].ref.id,"dc__gto__20261001_20261031");
  });
  await check("Read-denied goal stays truthful; incompatible currencies do not enter BRL progress",async()=>{
    await page.evaluate(()=>window.__goalError(true));await page.getByRole("status").filter({hasText:"Seu vínculo"}).waitFor();assert.match(await page.locator(".nvu-central-goal").innerText(),/250.000,00/);assert.doesNotMatch(await page.locator(".nvu-central-goal").innerText(),/Meta indisponível/);
    const attempts=await page.evaluate(()=>window.__goalReadStarts);
    await page.evaluate(()=>{for(let n=0;n<3;n++){window.dispatchEvent(new Event("online"));document.dispatchEvent(new Event("visibilitychange"));}});
    assert.equal(await page.evaluate(()=>window.__goalReadStarts),attempts,"An authorization rejection cannot create a read loop on resume");
    await page.evaluate(()=>{window.__goalError(false);window.__scenario({mixed:true});});
    await page.getByRole("button",{name:"Atualizar meta",exact:true}).click();
    await page.waitForFunction(()=>!document.querySelector(".nvu-central-goal").textContent.includes("Seu vínculo"));
    const percent=await page.getByRole("progressbar",{name:"Meta financeira do período"}).getAttribute("aria-valuenow");assert.ok(Math.abs(Number(percent)-70.841)<.001,percent);
    assert.match(await page.locator(".nvu-central-earnings").innerText(),/1 viagem sem moeda/);
  });
  await fresh();
  await check("Goal waits for restored Firebase identity and recovers without an offline/online toggle",async()=>{
    await page.evaluate(()=>{window.__goalAuth(false);window.__scenario({activeCompanyId:"other"});});
    await page.waitForFunction(()=>document.querySelector('.nvu-central-company-name').textContent.includes('Outra'));
    assert.equal(await page.evaluate(()=>window.__goalSubscriptions),0);
    await page.evaluate(()=>window.__goalAuth(true));
    await page.waitForFunction(()=>document.querySelector('.nvu-central-goal-values').textContent.includes('500.000,00'));
    assert.equal(await page.evaluate(()=>window.__goalSubscriptions),1);
    assert.doesNotMatch(await page.locator('.nvu-central-goal').innerText(),/Sem permissão/);
  });
  await fresh();
  await check("Empty/missing photo and overdue states",async()=>{
    await page.evaluate(()=>window.__scenario({missing:true,late:true}));
    await page.getByText("Foto do veículo indisponível",{exact:true}).waitFor();assert.equal(await page.locator(".nvu-central-job-status").innerText(),"Atrasado");
    assert.equal(await page.locator(".nvu-central-title-count .nvu-central-count").innerText(),"1");
    await page.evaluate(()=>window.__scenario({empty:true}));assert.match(await page.locator(".nvu-central-empty").innerText(),/Nenhum trabalho/);
  });
  await fresh();
  await check("Cancel confirmation stays separate from information and updates actual job service",async()=>{
    await page.getByRole("button",{name:"Ver informações de Iveco S Way"}).click();
    await page.getByRole("button",{name:"Cancelar trabalho",exact:true}).click();
    const dialog=page.getByRole("dialog",{name:"Cancelar trabalho"});await dialog.waitFor();
    await page.keyboard.press("Escape");assert.equal(await page.getByRole("dialog").count(),1);
    await page.getByRole("button",{name:"Cancelar trabalho",exact:true}).click();await dialog.getByRole("button",{name:"Confirmar cancelamento"}).click();
    assert.deepEqual(await page.evaluate(()=>window.__cancels),["operation"]);
    assert.equal(await page.getByRole("dialog").count(),0);
  });
  await fresh();
  for(const [label,tab,fleet] of [["Operações","fleet","contracts"],["Equipes","fleet","drivers"],["Recursos Humanos","hr"],["Frota","fleet","vehicles"],["Viagens","history"]]) {
    await check(`Action navigation: ${label}`,async()=>{
      await page.getByRole("button",{name:label,exact:true}).click();
      await page.waitForFunction(expected=>window.__route.state?.activeTab===expected,tab);
      const route=await page.evaluate(()=>window.__route);assert.equal(route.state.activeTab,tab);if(fleet)assert.equal(route.state.activeFleetTab,fleet);
      if(tab==="history") {
        // Activity now owns the approved profile cover instead of the former
        // centered tools heading. Other management destinations keep it.
        await page.locator('.nvu-cover-hero:visible[data-profile-scope="company"]').waitFor();
        assert.equal(await page.locator('.nvu-cover-hero:visible[data-profile-scope="company"]').count(),1);
        assert.equal(await page.locator('.nvu-workspace-page-title').count(),0);
        assert.equal(await page.locator('.nvu-cover-copy h2').innerText(),'DC Transportes');
      } else {
      const centered=await page.locator('.nvu-workspace-page-title > p').evaluate(p=>{const a=p.getBoundingClientRect(),b=p.parentElement.getBoundingClientRect();return {delta:Math.abs((a.left+a.right-b.left-b.right)/2),text:getComputedStyle(p).textAlign};});assert(centered.delta<1&&centered.text==="center",label+JSON.stringify(centered));
      }
      const ending=await page.evaluate(()=>({scroll:document.documentElement.scrollHeight,height:innerHeight}));if(!(audit489&&label==="Frota"))assert(ending.scroll<=ending.height+1,"A short tools page must not create a blank scroll area after its dock");
      await page.evaluate(()=>window.__go("/admin/fleet",{state:{activeTab:"operations"}}));await ready();

    });
  }
  await check("Shared dock has six destinations, selected management grid",async()=>{
    assert.equal(await page.locator(".nvu-driver-dock-item").count(),6);
    assert.equal(await page.getByRole("button",{name:"Gestão",exact:true}).getAttribute("aria-current"),"page");
    assert.equal(await page.locator(".nvu-driver-dock .lucide-layout-grid").count(),1);
  });
  await check("Frota defaults to vehicles and switches trailers without legacy selectors",async()=>{
    await page.getByRole("button",{name:"Frota",exact:true}).click();
    if(audit489){
      await page.locator('[data-nvu-fleet-vehicle-icon]').last().waitFor();
      assert.equal(await page.locator('[data-nvu-fleet-vehicle-icon]').count(),16);
      assert.equal(await page.locator('[data-nvu-fleet-vehicle-icon] .lucide-key-round').count(),16);
      assert.equal(await page.locator('.nvu-central-content img:visible').count(),0,'Fleet inventory keeps icons despite available photos');
      for(const theme of ['light','dark']){
        await page.evaluate(theme=>window.dispatchEvent(new CustomEvent('nvu:theme-change',{detail:theme})),theme);
        await page.evaluate(()=>window.scrollTo(0,document.documentElement.scrollHeight));
        const gap=await page.locator('[data-nvu-fleet-vehicle-icon]').last().evaluate(n=>document.querySelector('.nvu-driver-dock').getBoundingClientRect().top-n.closest('.group').getBoundingClientRect().bottom);
        assert(gap>=7,'Last vehicle actions remain above dock: '+gap);
        await page.screenshot({path:path.join(output,'fleet-ending-'+theme+'.png')});
      }
      await page.evaluate(()=>window.scrollTo(0,0));
    }
    await page.getByRole("button",{name:"Reboques",exact:true}).click();
    await page.waitForFunction(()=>window.__route.state.activeFleetTab==="trailers");
    assert.equal((await page.evaluate(()=>window.__route)).state.activeFleetTab,"trailers");
    assert.equal(await page.getByRole("heading",{name:"Frota",exact:true}).count(),1);
    assert.equal(await page.getByRole("button",{name:"Central de gestão",exact:true}).count(),0);
    assert.equal(await page.locator(".nvu-fleet-assets-switch button").count(),2);
    await page.evaluate(()=>window.__go(-1));
    await page.waitForFunction(()=>window.__route.state.activeFleetTab==="vehicles");
    await page.evaluate(()=>window.__go("/admin/fleet",{state:{activeTab:"operations"}}));await ready();
  });
  await check("Company profile uses the shared cover with a solid theme-aware header",async()=>{
    await page.evaluate(()=>window.__go("/admin/fleet",{state:{activeTab:"company"}}));
    await page.locator('[data-profile-scope="company"]').waitFor();
    assert.equal(await page.getByRole("heading",{name:"Meu perfil",exact:true}).count(),1);
    assert.equal(await page.locator(".nvu-company-profile-page .nvu-driver-surface").count(),1);
    assert.equal(await page.locator(".nvu-company-profile-route [data-nvu-hero-chrome]").count(),1);
    assert.equal(await page.locator('.nvu-cover-hero:visible').count(),1);
    assert.equal(await page.locator('.nvu-profile-hero').count(),0);
    for(const dark of [false,true]) {
      await page.evaluate(dark=>window.dispatchEvent(new CustomEvent('nvu:theme-change',{detail:dark?'dark':'light'})),dark);
      // CSS may serialize the transition as oklab rather than rgb. Compare
      // rendered sRGB channels once settled, allowing only rounding/quiet-surface variance.
      const settled=await page.waitForFunction(()=>{
        const header=document.querySelector('.nvu-admin-header'),style=getComputedStyle(header);
        const canvas=document.createElement('canvas'),context=canvas.getContext('2d',{willReadFrequently:true});
        const rgba=color=>{context.clearRect(0,0,1,1);context.fillStyle=color;context.fillRect(0,0,1,1);return [...context.getImageData(0,0,1,1).data];};
        const actual=rgba(style.backgroundColor),expected=rgba(getComputedStyle(document.body).backgroundColor);
        const stops=[...style.backgroundImage.matchAll(/rgba\(([^)]+)\)/g)];
        const neutralImage=style.backgroundImage==='none'||(style.backgroundImage.startsWith('linear-gradient(')&&stops.length>0&&stops.every(stop=>Number(stop[1].split(',').at(-1))===0));
        return actual[3]===255&&neutralImage&&actual.slice(0,3).every((value,i)=>Math.abs(value-expected[i])<=3)?{actual,expected}:false;
      });
      const colors=await settled.jsonValue();assert(colors.actual.slice(0,3).every((value,i)=>Math.abs(value-colors.expected[i])<=3));

    }
    await page.evaluate(()=>window.dispatchEvent(new CustomEvent('nvu:theme-change',{detail:'light'})));
    await page.evaluate(()=>window.__go("/admin/fleet",{state:{activeTab:"operations"}}));await ready();
  });
  await check("Cross-route return keeps Fleet mounted and goal subscription alive",async()=>{
    const mounts=await page.evaluate(()=>window.__fleetMounts);
    const offset=await page.evaluate(()=>Math.floor(Math.min(280,document.documentElement.scrollHeight-innerHeight)));
    assert(offset>=60,"The fixture must provide actual scrollable content, not empty footer padding");
    await page.evaluate(offset=>window.scrollTo(0,offset),offset);
    await page.waitForFunction(offset=>window.scrollY===offset,offset);
    await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(resolve)));
    await page.evaluate(()=>window.__go("/admin/news"));
    await page.waitForFunction(()=>window.__route.pathname==="/admin/news");
    await page.evaluate(()=>window.__go(-1));await ready();
    assert.equal(await page.evaluate(()=>window.__fleetMounts),mounts);
    assert.equal(await page.evaluate(()=>window.scrollY),offset);
    assert.equal(await page.evaluate(()=>window.__goalSubscriptions),1);
    await page.evaluate(()=>window.scrollTo(0,0));
  });
  async function swipe(selector, dx, dy=0, startX=200) {
    return page.locator(selector).first().evaluate((node,{dx,dy,startX})=>{
      const touch=(x,y)=>new Touch({identifier:1,target:node,clientX:x,clientY:y});
      node.dispatchEvent(new TouchEvent("touchstart",{bubbles:true,cancelable:true,touches:[touch(startX,300)]}));
      const move=new TouchEvent("touchmove",{bubbles:true,cancelable:true,touches:[touch(startX+dx,300+dy)]});node.dispatchEvent(move);
      node.dispatchEvent(new TouchEvent("touchend",{bubbles:true,cancelable:true,touches:[],changedTouches:[touch(startX+dx,300+dy)]}));return move.defaultPrevented;
    },{dx,dy,startX});
  }
  await check("Horizontal swipes follow dock order; reverse and vertical/edge/modal guards",async()=>{
    assert.equal(await swipe(".nvu-central-intro",-110),true);
    await page.waitForFunction(()=>window.__route.pathname==="/admin/history");
    assert.equal(await swipe('[data-nvu-retained-route="/admin/history"]',110),true);await ready();
    const before=await page.evaluate(()=>window.__route);
    assert.equal(await swipe(".nvu-central-intro",10,100),false);
    assert.equal(await swipe(".nvu-central-intro",-100,0,8),false);
    assert.deepEqual(await page.evaluate(()=>window.__route),before);
    await page.waitForTimeout(380);
    await page.getByRole("button",{name:"Ajustar meta financeira"}).click();
    assert.equal(await swipe('input[inputmode="decimal"]',-100),false);
    assert.deepEqual(await page.evaluate(()=>window.__route),before);await page.keyboard.press("Escape");
    assert.equal(await page.evaluate(()=>window.__fleetMounts),1);
  });
  await check("Offline restart restores summary, operations and goal; edit queues until reconnect",async()=>{
    await page.evaluate(()=>{localStorage.setItem("__qa-offline","true");Object.defineProperty(navigator,"onLine",{value:false,configurable:true});window.dispatchEvent(new Event("offline"));window.__scenario({empty:true});});
    assert.equal(await page.locator(".nvu-central-operation").count(),1);
    assert.match(await page.locator(".nvu-central-cache-status").innerText(),/Offline.*dados salvos/);
    await page.getByRole("button",{name:"Ajustar meta financeira"}).click();
    await page.getByRole("textbox").fill("300000");await page.getByRole("button",{name:"Salvar meta"}).click();
    assert.match(await page.locator(".nvu-central-goal").innerText(),/300.000,00/);
    assert.match(await page.locator(".nvu-central-goal").innerText(),/aguardando sincronização/);
    assert.equal(await page.evaluate(()=>window.__writes.length),0);
    await page.reload();await ready();
    assert.equal(await page.evaluate(()=>window.__writes.length),0);
    assert.match(await page.locator(".nvu-central-goal").innerText(),/300.000,00/);
    assert.equal(await page.locator(".nvu-central-operation").count(),1);
    await page.evaluate(()=>{localStorage.removeItem("__qa-offline");Object.defineProperty(navigator,"onLine",{value:true,configurable:true});window.dispatchEvent(new Event("online"));});
    await page.waitForFunction(()=>window.__writes.length===1);
    assert.equal((await page.evaluate(()=>window.__writes))[0].data.targetAmount,300000);
  });
  await check("Horizontal central: centered columns of equal height with room around them, left column and compact job rows, from large to small windows",async()=>{
    await fresh();
    await page.setViewportSize({width:1280,height:800});
    await page.evaluate(()=>window.__scenario({many:true}));
    await page.waitForFunction(()=>document.querySelectorAll(".nvu-central-operation").length===8&&document.querySelector(".nvu-central-page").classList.contains("nvu-landscape-central"));
    await page.evaluate(()=>document.fonts.ready);
    const read=async()=>{
      await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
      return page.evaluate(()=>{
        const box=selector=>{const node=document.querySelector(selector);if(!node)return null;const r=node.getBoundingClientRect();return {left:r.left,right:r.right,top:r.top,bottom:r.bottom,height:r.height};};
        const list=document.querySelector(".nvu-central-job-list");
        return {flagged:document.querySelector(".nvu-central-page").classList.contains("nvu-landscape-central"),title:box(".nvu-workspace-page-title"),company:box(".nvu-central-company-row"),simulator:box(".nvu-central-simulator"),summary:box(".nvu-central-summary"),actions:box(".nvu-central-actions"),jobs:box(".nvu-central-jobs"),chip:box(".nvu-central-summary-heading > .nvu-central-period"),photo:box(".nvu-central-vehicle-photo"),info:box(".nvu-central-operation-info"),
          list:{client:list.clientHeight,scroll:list.scrollHeight,overflow:getComputedStyle(list).overflowY},doc:{scroll:document.documentElement.scrollHeight,inner:innerHeight,scrollWidth:document.documentElement.scrollWidth,width:innerWidth},
          rows:[...document.querySelectorAll(".nvu-central-operation")].map(node=>node.getBoundingClientRect().height),buttons:[...document.querySelectorAll(".nvu-central-action")].map(node=>node.getBoundingClientRect().height)};
      });
    };
    for(const [width,height] of [[2560,1300],[1911,947],[1440,900],[1366,768],[1280,720],[1100,700],[1024,768]]){
      await page.setViewportSize({width,height});
      const wide=await read(),info=width+"x"+height+" "+JSON.stringify(wide);
      assert(wide.flagged,info);
      for(const key of ["company","summary","actions"]) assert(Math.abs(wide[key].left-wide.company.left)<=1&&wide[key].right<=wide.jobs.left,key+" "+info);
      assert(wide.simulator.right<=wide.jobs.left,info);
      assert(Math.abs((wide.company.left+wide.jobs.right)/2-wide.doc.width/2)<=1,"The two columns are centered on the window: "+info);
      assert(wide.title.bottom<=wide.company.top&&wide.jobs.top-wide.title.bottom>=12,"Room between the title and the cards: "+info);
      assert(Math.abs(wide.jobs.top-wide.company.top)<=1&&wide.jobs.left>wide.actions.right,info);
      assert(Math.abs(wide.jobs.bottom-wide.actions.bottom)<=1,"Both columns end on the same line: "+info);
      assert(wide.doc.inner-wide.jobs.bottom>=18,"Room between the cards and the bottom of the screen: "+info);
      assert(wide.doc.scroll<=wide.doc.inner+1&&wide.doc.scrollWidth<=wide.doc.width,"The management center fits the window: "+info);
      assert(wide.list.overflow==="auto"&&wide.list.scroll>wide.list.client,"The job list scrolls inside its card: "+info);
      assert(wide.rows.length===8&&wide.rows.every(rowHeight=>rowHeight<=140),"Operations use compact rows: "+info);
      assert(wide.buttons.length===6&&wide.buttons.every(buttonHeight=>buttonHeight>=30&&buttonHeight<=64),"The six management buttons share the left column height: "+info);
      assert(Math.abs((wide.photo.right-wide.photo.left)/wide.photo.height-16/9)<=.03,"The vehicle photo is a 16:9 rectangle, not a square: "+info);
      assert(wide.info.right-wide.info.left<=21&&wide.info.height<=21&&wide.info.right<=wide.photo.right&&wide.info.top>=wide.photo.top,"The information button is small and stays on the photo: "+info);
      assert(wide.chip.height<=26,"The period button stays compact: "+info);
    }
    await page.setViewportSize({width:1280,height:800});
    await read();
    await page.evaluate(()=>{document.querySelector(".nvu-central-job-list").scrollTop=300;});
    assert.deepEqual(await page.evaluate(()=>({page:scrollY,list:document.querySelector(".nvu-central-job-list").scrollTop>0})),{page:0,list:true},"Scrolling the list must not scroll the page");
    await page.setViewportSize({width:390,height:867});
    await page.waitForFunction(()=>!document.querySelector(".nvu-central-page").classList.contains("nvu-landscape-central"));
    const narrow=await read();
    assert(!narrow.flagged,JSON.stringify(narrow));
    assert(narrow.summary.top<narrow.actions.top&&narrow.actions.top<narrow.jobs.top&&Math.abs(narrow.jobs.left-narrow.summary.left)<=1&&narrow.rows.every(rowHeight=>rowHeight>250),"Portrait keeps the single column and the full cards: "+JSON.stringify(narrow));
    assert(Math.abs((narrow.photo.right-narrow.photo.left)/narrow.photo.height-2.64)<=.03&&narrow.info.height>=32&&narrow.chip.height>=26,"Portrait keeps the approved photo, information button and period button: "+JSON.stringify(narrow));
    await page.evaluate(()=>window.__scenario({many:false}));
  });
  await check("Smartphone in landscape: one narrow scrolling column, summary and shortcuts in view, hint to the jobs",async()=>{
    await fresh();
    await page.setViewportSize({width:986,height:444});
    await page.evaluate(()=>window.__scenario({many:true}));
    await page.waitForFunction(()=>document.querySelectorAll(".nvu-central-operation").length===8&&getComputedStyle(document.querySelector(".nvu-central-stack")).display==="block");
    await page.evaluate(()=>document.fonts.ready);
    await page.locator(".nvu-central-more-hint button").waitFor();
    const read=()=>page.evaluate(()=>{
      const box=selector=>{const node=document.querySelector(selector);if(!node)return null;const r=node.getBoundingClientRect();return {left:r.left,right:r.right,top:r.top,bottom:r.bottom,width:r.width};};
      return {stack:box(".nvu-central-stack"),summary:box(".nvu-central-summary"),actions:box(".nvu-central-actions"),jobs:box(".nvu-central-jobs"),hint:box(".nvu-central-more-hint button"),
        doc:{scrollWidth:document.documentElement.scrollWidth,width:innerWidth,height:innerHeight,scroll:document.documentElement.scrollHeight},list:getComputedStyle(document.querySelector(".nvu-central-job-list")).overflowY};
    });
    const first=await read(),info=JSON.stringify(first);
    assert(first.stack.width<=661&&Math.abs((first.stack.left+first.stack.right)/2-first.doc.width/2)<=1,"One narrow centered column: "+info);
    assert(first.summary.bottom<=first.doc.height&&first.actions.bottom<=first.doc.height-40&&first.actions.top>first.summary.bottom,"Summary and shortcuts are fully in view: "+info);
    assert(first.jobs.top>=first.actions.bottom&&first.doc.scroll>first.doc.height&&first.doc.scrollWidth<=first.doc.width&&first.list==="visible","The jobs card follows below the fold: "+info);
    assert(first.hint&&first.hint.bottom<=first.doc.height,"The hint to the jobs card is visible: "+info);
    await page.locator(".nvu-central-more-hint button").dispatchEvent("click");
    await page.waitForFunction(()=>!document.querySelector(".nvu-central-more-hint")&&document.querySelector(".nvu-central-jobs").getBoundingClientRect().top<200);
    await page.evaluate(()=>window.scrollTo(0,0));
    await page.setViewportSize({width:1280,height:800});
    await page.waitForFunction(()=>getComputedStyle(document.querySelector(".nvu-central-stack")).display==="grid");
    await page.evaluate(()=>window.__scenario({many:false}));
  });
  await check("Designar Trabalhos keeps the existing assignment route",async()=>{
    await page.getByRole("button",{name:"Designar Trabalhos",exact:true}).click();
    await page.waitForFunction(()=>window.__route.pathname==="/admin/assign");
    assert.equal((await page.evaluate(()=>window.__route)).pathname,"/admin/assign");
  });
  assert.deepEqual(errors,[]);assert.deepEqual(outbound,[]);
  await fs.writeFile(path.join(output,"results.json"),JSON.stringify({results,errors,outbound},null,2));
  console.log(`CENTRAL_UI_PASS ${results.length} checks; no external requests or browser errors.`);
} finally { await browser.close(); }
