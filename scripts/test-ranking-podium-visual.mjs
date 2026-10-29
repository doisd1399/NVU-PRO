import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { build } from "esbuild";

const root = process.cwd();
const output = path.resolve(process.env.NVU_PODIUM_QA_DIR || "verification/ranking-gamer");
await fs.mkdir(output, { recursive: true });
let playwright;
try { playwright = await import("playwright"); }
catch { playwright = await import(pathToFileURL(path.join(process.env.CODEX_PRIMARY_RUNTIME_NODE_MODULES, "playwright/index.mjs")).href); }
const photos = {};
for (const name of ["jose", "thiago", "ferreira"]) photos[name] = `data:image/png;base64,${(await fs.readFile(`verification/podium/photo-${name}.png`)).toString("base64")}`;
const cssFiles = (await fs.readdir("dist/assets")).filter(name => /^(index|RankingGlobal)-.*\.css$/.test(name));
assert.ok(cssFiles.length > 0, "Build the application before running visual QA");
const css = (await Promise.all(cssFiles.map(name => fs.readFile("dist/assets/"+name,"utf8")))).join("\n");

const mocks = `
import React,{useState,useMemo} from "react";
import {parseRankingAggregateDocument} from "./src/lib/rankingAggregates";
const photos=${JSON.stringify(photos)};
export const users=[
 {id:"thiago",name:"Thiago Caetano",companyId:"dc",val:1792705,trips:70},
 {id:"jose",name:"José Macedo",companyId:"dc",val:1621529,trips:55},
 {id:"ferreira",name:"Jose Ferreira",companyId:"dc",val:364687,trips:25},
 {id:"fourth",name:"Quarto Participante",companyId:"dc",val:12.34,trips:1}
].map(x=>({...x,currency:"BRL",logo:photos[x.id]||"",profilePhotoURL:photos[x.id]||"",roles:["driver"]}));
export const companies=[{id:"dc",name:"DC Transportes",companyName:"DC Transportes",simulatorId:"gto",status:"active"},{id:"second",name:"Segunda empresa",companyName:"Segunda empresa",simulatorId:"gto",status:"active"},{id:"third",name:"Terceira empresa",companyName:"Terceira empresa",simulatorId:"gto",status:"active"}];
const simulators=[{id:"gto",name:"GTO"}];
const members=users.map(u=>({userId:u.id,companyId:"dc",status:"active",roles:["driver"]}));
const trips=users.flatMap(u=>Array.from({length:u.trips},(_,i)=>({id:u.id+i,driverId:u.id,companyId:"dc",simulatorId:"gto",status:"concluida",valor:i===0?u.val:0,currency:"BRL",currencyStatus:"known",completedAt:"2026-10-10T12:00:00Z"})));
const empty=[];
const noop=()=>{};
const load=async()=>{};
export function useSessionStore(){return {currentUser:users[0]};}
export function useOperationalStore(){return {simulators,simulatorsLoading:false,users,jobs:empty,vehicles:empty};}
export function useCompanyStore(){return {activeCompanyId:"dc",allCompanies:companies,companies,companiesLoading:false,companyCatalogLoaded:true,companyCatalogAttempted:true,loadCompanyCatalog:load,allCompanyMembers:members};}
export function useNotificationStore(){return {notifications:empty,markNotificationAsRead:noop};}
export function useRankingFilterStore(){const [p,setP]=useState("mes");const [s,setS]=useState("");const [e,setE]=useState("");return {globalPeriodPreset:p,setGlobalPeriodPreset:setP,globalStartDateStr:s,setGlobalStartDateStr:setS,globalEndDateStr:e,setGlobalEndDateStr:setE};}
export function useLiveCalendarReference(){return useMemo(()=>new Date("2026-10-11T12:00:00Z"),[]);}
export function useRankingAggregate(options){const aggregate=useMemo(()=>parseRankingAggregateDocument({schemaVersion:4,simulatorId:options.simulatorId,periodType:options.periodType,periodKey:options.periodKey,periodTimeZone:"America/Sao_Paulo",periodPolicy:"SAO_PAULO_CALENDAR",complete:true,sourceTripCount:151,companies:{dc:{val:1792705,trips:70,currency:"BRL"},second:{val:1621529,trips:55,currency:"BRL"},third:{val:364687,trips:25,currency:"BRL"}},drivers:Object.fromEntries(users.map(u=>[u.id,u]))}),[options.simulatorId,options.periodType,options.periodKey]);return {aggregate:options.enabled?aggregate:null,status:"ready",loading:false,refreshing:false,error:null};}
export function useRankingCompaniesByIds(){return {companies,loading:false,refreshing:false,complete:true,serverConfirmed:true,error:null};}
export function useRankingUsersRealtime(){return {users,loading:false,refreshing:false,error:null};}
export function useTripsRealtime(){return {trips,loading:false,refreshing:false,serverConfirmed:true,error:null};}
export const auth={currentUser:{uid:"thiago"}};
export const db={},functions={};
export const warmRankingPhotosForIds=load,warmRankingUserProfiles=load;
export function useRankingVehiclePhotoPrefetch(){}
export function NotificationCenter(){return <button aria-label="Notificações"><svg width="16" height="16" viewBox="0 0 24 24" fill="none"><path d="M18 8a6 6 0 00-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9ZM10 21h4" stroke="currentColor" strokeWidth="1.8"/></svg></button>;}
export default function Modal(props){return <div role="dialog" data-testid="handoff-modal"><span>{props.item.name}</span><span>{props.rank}º</span><button onClick={props.onClose}>Fechar</button></div>;}
`;
const intercept = new Set(["AppContext.tsx", "CompanyContext.tsx", "NotificationsContext.tsx", "useRankingAggregate.ts", "useRankingCompaniesByIds.ts", "useRankingUsersRealtime.ts", "useTripsRealtime.ts", "useLiveCalendarReference.ts", "useRankingVehiclePhotoPrefetch.ts", "rankingPhotoWarmup.ts", "firebase.ts", "NotificationCenter.tsx", "RankingParticipantPremiumModal.tsx"]);
const bundle = await build({
  stdin: { sourcefile:"podium-qa.tsx",resolveDir:root,loader:"tsx",contents:`
import React,{useState} from "react";import {createRoot} from "react-dom/client";import {MemoryRouter} from "react-router-dom";
import RankingPremiumPodium from "./src/components/RankingPremiumPodium";import RankingGlobal from "./src/pages/RankingGlobal";import {RankingGamerLeaderboard} from "./src/components/RankingGamerLeaderboard";
import {users} from "podium-mocks";import {getRankingImage,rankingImageKey} from "./src/services/rankingImageStore";
function Fixture(){const [mode,setMode]=useState("normal");const [mounted,setMounted]=useState(true);window.__setPodiumMode=setMode;window.__setPodiumMounted=setMounted;
 const items=mode==="single"?users.slice(0,1):mode==="long"?users.slice(0,3).map((u,i)=>({...u,name:"Cooperativa de Transportes Rodoviários "+i,val:9999999999.99})):mode==="missing"?users.slice(0,3).map(u=>({...u,id:"no-photo-"+u.id,logo:""})):mode==="mixed"?users.slice(0,3).map(u=>({...u,money:"R$ 1.621.529,00 · € 9.123,45",currencyBreakdown:[{currency:"BRL",value:1621529},{currency:"EUR",value:9123.45}]})):users;
 const money=item=>item.money||new Intl.NumberFormat("pt-BR",{style:"currency",currency:"BRL"}).format(item.val);
 const open=(item,rank)=>{window.__lastPodiumClick={id:item.id,rank};};
 return mounted?<div className="nvu-gamer-ranking" style={{padding:12}}><RankingPremiumPodium items={items} viewerId="fixture-viewer" assetType={mode==="companies"?"company":"driver"} formatCurrency={money} onOpen={open}/><RankingGamerLeaderboard items={items.slice(0,3)} viewerId="fixture-viewer" assetType={mode==="companies"?"company":"driver"} showPhotos={false} criticalLimit={3} formatCurrency={money} formatAmount={(v,c)=>new Intl.NumberFormat("pt-BR",{style:"currency",currency:c}).format(v)} onOpen={open}/></div>:null;}

async function boot(){if(!localStorage.getItem("podium-fixture-seeded")){const req=indexedDB.open("nvu-ranking-images-v1",1);await new Promise((resolve,reject)=>{req.onupgradeneeded=()=>req.result.createObjectStore("images",{keyPath:"key"});req.onerror=reject;req.onsuccess=()=>{const db=req.result,tx=db.transaction("images","readwrite");for(const viewerId of ["fixture-viewer","thiago"])for(const u of users.slice(0,3))for(const kind of ["driver","company"]){const id={viewerId,assetId:kind+":"+u.id};tx.objectStore("images").put({...id,key:rankingImageKey(id),remoteUrl:u.logo,dataUrl:u.logo,savedAt:Date.now()});}tx.oncomplete=()=>{db.close();localStorage.setItem("podium-fixture-seeded","yes");resolve();};};});}
 for(const u of users.slice(0,3))for(const viewerId of ["fixture-viewer","thiago"])for(const kind of ["driver","company"])await getRankingImage({viewerId,assetId:kind+":"+u.id});
 const isPage=location.search.includes("page");if(!isPage)document.body.style.margin="0";
 createRoot(document.getElementById("root")).render(isPage?<MemoryRouter initialEntries={[{pathname:"/ranking",state:{profileRanking:{type:"global",simulatorId:"gto",periodType:"mes"}}}]}><div className="nvu-native-android nvu-ranking-overlay"><RankingGlobal/></div></MemoryRouter>:<Fixture/>);}
boot();
` },
  bundle:true,write:false,outfile:path.join(output,"fixture-bundle.js"),format:"iife",platform:"browser",jsx:"automatic",
  loader:{".css":"empty"}, // Use the actual Vite-produced CSS read above.
  define:{"process.env.NODE_ENV":'"test"',"import.meta.env.BASE_URL":'"/"'},
  plugins:[{name:"isolated-remote-adapters",setup(plugin){
    plugin.onResolve({filter:/^podium-mocks$/},()=>({path:"mocks",namespace:"fixture"}));
    plugin.onLoad({filter:/.*/,namespace:"fixture"},()=>({contents:mocks,resolveDir:root,loader:"tsx"}));
    plugin.onLoad({filter:/src\/.*\.tsx?$/},args=>intercept.has(path.basename(args.path))?{contents:'export * from "podium-mocks"; export {default} from "podium-mocks";',resolveDir:root,loader:"tsx"}:undefined);
  }}],
});
const js = bundle.outputFiles.find(x=>x.path.endsWith(".js"))?.text || bundle.outputFiles[0].text;
const html=`<!doctype html><html class="dark"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>${css}</style></head><body><div id="root"></div><script>${js.replace(/<\/script/gi,"<\\/script")}</script></body></html>`;
await fs.writeFile(path.join(output,"fixture.html"),html);
const browser = await playwright.chromium.launch({headless:true,...(process.env.NVU_CHROMIUM_EXECUTABLE?{executablePath:process.env.NVU_CHROMIUM_EXECUTABLE}:{}),args:["--no-sandbox","--disable-dev-shm-usage"]});
const results=[], errors=[], external=[];
const context=await browser.newContext({viewport:{width:691,height:555},deviceScaleFactor:1});
const fulfillFixture=async route=>{
 const url=new URL(route.request().url());
 if(url.hostname!=="127.0.0.1"){external.push(url.href);return route.abort();}
 if(url.pathname.startsWith("/assets/ranking-podium/")){return route.fulfill({contentType:url.pathname.endsWith('.woff2')?"font/woff2":"image/png",body:await fs.readFile(path.join(root,"public",url.pathname))});}
 return route.fulfill({contentType:"text/html",body:html});
};
await context.route("**/*",fulfillFixture);
const page=await context.newPage();page.on("pageerror",e=>errors.push(e.message));
async function check(name,run){await run();results.push({name,pass:true});console.log("PASS "+name);}
async function ready(){await page.getByTestId("ranking-premium-podium").waitFor();await page.waitForFunction(()=>[...document.querySelectorAll('.nvu-podium-photo img')].every(i=>i.complete&&i.naturalWidth));await page.evaluate(()=>document.fonts.ready);}
try {
 await page.goto("http://127.0.0.1:47831/");await ready();
 await page.locator('.nvu-premium-podium').screenshot({path:path.join(output,"podium-dark-reference-size.png")});
 await check("Exact real names, amounts, trips and 2-1-3 order",async()=>{
  assert.deepEqual(await page.locator('[data-testid^="podium-place-"]').evaluateAll(es=>es.map(e=>e.getAttribute('data-participant-id'))),["jose","thiago","ferreira"]);
  for(const text of ["R$ 1.621.529,00","R$ 1.792.705,00","R$ 364.687,00","55 viagens","70 viagens","25 viagens"])assert.ok((await page.locator('.nvu-podium-participant').evaluateAll(es=>es.map(e=>e.getAttribute('aria-label')).join(' '))).replace(/\s/g," ").includes(text));
 });
 await check("Click on each photograph preserves participant and rank",async()=>{for(const [rank,id] of [[2,"jose"],[1,"thiago"],[3,"ferreira"]]){await page.getByTestId('podium-place-'+rank).locator('.nvu-podium-photo').click();assert.deepEqual(await page.evaluate(()=>window.__lastPodiumClick),{id,rank});}});
 await check("Native keyboard activation",async()=>{await page.getByTestId('podium-place-2').focus();await page.keyboard.press("Enter");assert.deepEqual(await page.evaluate(()=>window.__lastPodiumClick),{id:"jose",rank:2});await page.getByTestId('podium-place-3').focus();await page.keyboard.press("Space");assert.deepEqual(await page.evaluate(()=>window.__lastPodiumClick),{id:"ferreira",rank:3});});
 for(const width of [320,360,390,412,691,1024])for(const theme of ["dark","light"]){
  await page.setViewportSize({width,height:900});await page.evaluate(t=>document.documentElement.className=t,theme);
  await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
  await check(`No clipping/overflow at ${width}px / ${theme}`,async()=>{
   const metrics=await page.evaluate(()=>({width:innerWidth,scroll:document.documentElement.scrollWidth,amounts:[...document.querySelectorAll('.nvu-gamer-money')].map(e=>({w:e.clientWidth,sw:e.scrollWidth})),photos:[...document.querySelectorAll('.nvu-podium-photo img')].map(e=>e.complete&&e.naturalWidth>0)}));
   assert.ok(metrics.scroll<=metrics.width,JSON.stringify(metrics));assert.ok(metrics.amounts.every(e=>e.sw<=e.w+1),JSON.stringify(metrics));assert.ok(metrics.photos.every(Boolean));
  });
  if([390,691].includes(width))await page.screenshot({path:path.join(output,`podium-${theme}-${width}.png`)});
 }
 await page.setViewportSize({width:320,height:300});
 for(const mode of ["long","mixed","missing","companies","single"]){await page.evaluate(m=>window.__setPodiumMode(m),mode);await check(`Real layout edge case: ${mode}`,async()=>{
  await page.waitForTimeout(70);
  assert.ok(await page.getByTestId('ranking-premium-podium').isVisible());
  const values=await page.locator('.nvu-gamer-money').evaluateAll(es=>es.map(e=>({w:e.clientWidth,sw:e.scrollWidth,text:e.textContent})));
  assert.ok(values.every(e=>e.sw<=e.w+1),JSON.stringify(values));
  const geometry=await page.locator('.nvu-podium-slot').evaluateAll(es=>es.map(e=>{
   const b=e.querySelector('.nvu-gamer-rank').getBoundingClientRect(),f=e.querySelector('.nvu-podium-participant').getBoundingClientRect();
   return {gap:f.top-b.bottom,left:f.left,right:f.right};
  }));
  assert.ok(geometry.every(g=>g.gap>=10&&g.left>=0&&g.right<=320),JSON.stringify(geometry));
  if(mode==="mixed"||mode==="single")assert.equal(await page.getByTestId('ranking-leadership-gap').count(),0);
  if(mode==="long")assert.ok(values.every(e=>e.text.includes("9.999.999.999,99")));
  if(mode==="missing")assert.equal(await page.locator('.nvu-podium-initials:visible').count(),3);
  if(mode==="single")assert.equal(await page.locator('button:disabled').count(),2);
  await page.screenshot({path:path.join(output,`edge-${mode}-320.png`)});
 });}
 await page.evaluate(()=>window.__setPodiumMode("normal"));
 await check("Theme change and reopen preserve images and cache IDs",async()=>{
  const before=await page.locator('.nvu-podium-photo img').evaluateAll(es=>es.map(e=>e.src));
  await page.evaluate(()=>{document.documentElement.className="dark";window.__setPodiumMounted(false);});await page.waitForTimeout(20);await page.evaluate(()=>window.__setPodiumMounted(true));await ready();
  assert.deepEqual(await page.locator('.nvu-podium-photo img').evaluateAll(es=>es.map(e=>e.src)),before);
 });
 await check("Cold offline reload uses durable local images and bundled decoration",async()=>{
  await context.setOffline(true);await page.reload();await ready();
  await page.waitForFunction(()=>document.querySelectorAll('.nvu-podium-photo img').length===3&&[...document.querySelectorAll('.nvu-podium-photo img')].every(i=>i.complete&&i.naturalWidth>0&&i.src.startsWith('data:image/')));
 });
 await context.setOffline(false);await page.setViewportSize({width:390,height:900});await page.goto("http://127.0.0.1:47831/?page");await ready();await page.getByRole('button',{name:/Filtros do ranking/}).click();
 for(const theme of ["dark","light"]){await page.evaluate(t=>document.documentElement.className=t,theme);await page.screenshot({path:path.join(output,`ranking-${theme}-390.png`),fullPage:true});}
 for(const width of [320,360,390,412])for(const theme of ["dark","light"]){
  await page.setViewportSize({width,height:Math.round(width*1536/691)});await page.evaluate(t=>document.documentElement.className=t,theme);
  await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
  await check(`Real ranking page at ${width}px / ${theme}`,async()=>{
   const metrics=await page.evaluate(()=>({width:innerWidth,scroll:document.documentElement.scrollWidth,
    plates:[...document.querySelectorAll('.nvu-podium-slot')].map(e=>{
      const frame=e.querySelector('.nvu-podium-participant').getBoundingClientRect(),badge=e.querySelector('.nvu-gamer-rank').getBoundingClientRect();
      return {gap:frame.top-badge.bottom,left:frame.left,right:frame.right};
    }),amounts:[...document.querySelectorAll('.nvu-gamer-money')].map(e=>({w:e.clientWidth,sw:e.scrollWidth})),
    photoCount:document.querySelectorAll('.nvu-podium-photo img').length
   }));
   assert.ok(metrics.scroll<=metrics.width,JSON.stringify(metrics));
   assert.equal(metrics.plates.length,3);
   assert.ok(metrics.plates.every(e=>e.gap>=10&&e.left>=0&&e.right<=metrics.width),JSON.stringify(metrics));
   assert.ok(metrics.amounts.every(e=>e.sw<=e.w+1),JSON.stringify(metrics));
   assert.equal(metrics.photoCount,3);
  });
 }
 const captureContext=await browser.newContext({viewport:{width:390,height:867},deviceScaleFactor:691/390});
 await captureContext.route("**/*",fulfillFixture);
 const capturePage=await captureContext.newPage();await capturePage.goto("http://127.0.0.1:47831/?page");
 await capturePage.getByTestId('ranking-premium-podium').waitFor();
 await capturePage.waitForFunction(()=>[...document.querySelectorAll('.nvu-podium-photo img')].every(i=>i.complete&&i.naturalWidth));
 await capturePage.evaluate(()=>document.fonts.ready);
 for(const theme of ["dark","light"]){
  await capturePage.evaluate(t=>document.documentElement.className=t,theme);
  await capturePage.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
  await capturePage.screenshot({path:path.join(output,`ranking-${theme}-reference-size.png`)});
 }
 await captureContext.close();await page.setViewportSize({width:390,height:900});
 await check("Real RankingGlobal modal handoff and collapsed participants",async()=>{
  await page.getByTestId('podium-place-1').locator('.nvu-podium-photo').click();assert.ok((await page.getByTestId('handoff-modal').innerText()).includes("Thiago Caetano"));await page.getByRole('button',{name:"Fechar",exact:true}).click();
  const more=page.getByRole('button',{name:"Ver demais participantes",exact:true});assert.equal(await more.getAttribute('aria-expanded'),"false");await more.click();
  await page.getByRole('button',{name:"Recolher participantes",exact:true}).waitFor();
  await page.getByText("Quarto Participante",{exact:true}).waitFor({state:"visible"});await page.getByRole('button',{name:"Recolher participantes",exact:true}).click();
 });
 await check("Theme switches change surfaces without remounting photographs",async()=>{
  const p=page.locator('.nvu-podium-photo img');
  await p.evaluateAll(es=>es.forEach(e=>e.dataset.qaIdentity="preserved"));
  const before=await p.evaluateAll(es=>es.map(e=>e.src));
  const surface=await page.locator('.nvu-podium-participant').first().evaluate(e=>getComputedStyle(e).getPropertyValue('--gamer-panel'));
  await page.evaluate(()=>document.documentElement.className=document.documentElement.className==="dark"?"light":"dark");
  assert.notEqual(await page.locator('.nvu-podium-participant').first().evaluate(e=>getComputedStyle(e).getPropertyValue('--gamer-panel')),surface);
  assert.deepEqual(await p.evaluateAll(es=>es.map(e=>e.src)),before);
  assert.ok(await p.evaluateAll(es=>es.every(e=>e.dataset.qaIdentity==="preserved")));
 });
 await check("Real leaderboard preserves full monetary values and modal identity",async()=>{
  const content=(await page.locator('.nvu-gamer-leaderboard').innerText()).replace(/\s/g," ");
  for(const v of ["R$ 1.792.705,00","R$ 1.621.529,00","R$ 364.687,00"])assert.ok(content.includes(v),content);
  assert.equal(await page.locator('.nvu-gamer-row-photo').count(),3);
  assert.ok((await page.locator('.nvu-gamer-row-photo').first().evaluate(e=>e.getBoundingClientRect().width))>=34);
  assert.equal(await page.getByTestId('ranking-leadership-gap').count(),0);
  await page.getByTestId('ranking-row-2').click();
  assert.ok((await page.getByTestId('handoff-modal').innerText()).includes("José Macedo"));
  await page.getByRole('button',{name:"Fechar",exact:true}).click();
 });
 await check("Shared simulator modal matches Panel interaction",async()=>{
  await page.getByRole('button',{name:"Simulador",exact:true}).click();
  const modal=page.getByRole('dialog');
  await modal.waitFor();
  assert.ok((await modal.getByText("Selecione o simulador",{exact:true}).count())===1);
  assert.ok((await modal.getByRole('option').count())>0);
  await modal.getByRole('option').first().click();
  assert.equal(await page.getByRole('dialog').count(),0);
 });
 await check("Simulator and period controls share compact geometry",async()=>{
  const sizes=await page.evaluate(()=>({simulator:document.querySelector('[aria-label="Simulador"]')?.getBoundingClientRect().width||0,period:document.querySelector('[aria-label="Escolher período do ranking"]')?.getBoundingClientRect().width||0}));
  assert.ok(Math.abs(sizes.simulator-sizes.period)<=2,JSON.stringify(sizes));
 });
 for(const scope of ["Empresarial","Interno","Global"]){await page.getByRole('button',{name:scope,exact:true}).click();if(scope==="Interno")await page.getByRole('combobox',{name:"Selecione a empresa"}).selectOption('dc');await ready();await check(`Real ranking scope: ${scope}`,async()=>{assert.equal(await page.locator('[data-testid^="podium-place-"]').count(),3);});}
 await check("Unified ranking surface has no Podium/List toggle",async()=>{assert.equal(await page.getByTestId('ranking-premium-podium').count(),1);assert.equal(await page.locator('.nvu-gamer-leaderboard').count(),1);assert.equal(await page.getByRole('button',{name:"Lista",exact:true}).count(),0);assert.equal(await page.getByRole('button',{name:"Pódio",exact:true}).count(),0);});
 await check("Font enlargement and native safe area preserve layout",async()=>{
  await page.setViewportSize({width:320,height:900});
  await page.addStyleTag({content:":root{--nvu-safe-top:28px;font-size:20px} .nvu-gamer-ranking{font-size:18px}"});
  await page.evaluate(()=>document.querySelectorAll('.nvu-gamer-row-name,.nvu-gamer-money,.nvu-gamer-trips,.nvu-podium-name,.nvu-podium-caption,.nvu-ranking-header h1,.nvu-gamer-simulator').forEach(e=>{
    e.style.fontSize=(parseFloat(getComputedStyle(e).fontSize)*1.3)+"px";
  }));
  const m=await page.evaluate(()=>({width:innerWidth,scroll:document.documentElement.scrollWidth,gaps:[...document.querySelectorAll('.nvu-podium-slot')].map(e=>e.querySelector('.nvu-podium-participant').getBoundingClientRect().top-e.querySelector('.nvu-gamer-rank').getBoundingClientRect().bottom)}));
  assert.ok(m.scroll<=m.width&&m.gaps.every(g=>g>=10),JSON.stringify(m));
  assert.ok(await page.locator('.nvu-gamer-money').evaluateAll(es=>es.every(e=>e.scrollWidth<=e.clientWidth+1)));
  await page.screenshot({path:path.join(output,"ranking-enlarged-font-320.png"),fullPage:true});
 });
 assert.deepEqual(errors,[]);assert.deepEqual(external,[]);
 await fs.writeFile(path.join(output,"results.json"),JSON.stringify({pass:true,checks:results.length,results,errors,externalRequests:external,limits:["Remote adapters and modal boundary use fixtures; production Firebase and physical Android device were not accessed.","Offline fixture serves bundled files locally, matching APK asset availability; this is not a website service-worker test."]},null,2));
 console.log(`PODIUM_VISUAL_PASS ${results.length} checks`);
} finally {await browser.close();}
