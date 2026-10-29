import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import http from "node:http";
import {pathToFileURL} from "node:url";
import {build} from "esbuild";
const root=process.cwd(), output=path.resolve("verification/workspace-503");
await fs.mkdir(output,{recursive:true});
let playwright;try{playwright=await import("playwright");}catch{playwright=await import(pathToFileURL(path.join(process.env.CODEX_PRIMARY_RUNTIME_NODE_MODULES,"playwright/index.mjs")).href);}
const css=(await Promise.all((await fs.readdir("dist/assets")).filter(name=>name.endsWith(".css")).map(name=>fs.readFile(`dist/assets/${name}`,"utf8")))).join("\n");
const result=await build({stdin:{sourcefile:"workspace-503-ui.tsx",resolveDir:root,loader:"tsx",contents:`
import React,{useState} from "react";import {createRoot} from "react-dom/client";import {MemoryRouter,useLocation,useNavigate} from "react-router-dom";
import {GlobalMenu} from "./src/components/GlobalMenu";import {COMPANY_MENU_GROUPS,DRIVER_MENU_ITEMS} from "./src/components/workspaceMenuItems";
import {ManagementDashboard} from "./src/components/admin/management/ManagementDashboard";import {dismissTopOptionModal} from "./src/lib/optionModalStack";
function App(){const [profile,setProfile]=useState("driver"),[open,setOpen]=useState(false),[account,setAccount]=useState(false),[companySwitch,setCompanySwitch]=useState(false),[theme,setTheme]=useState("light"),[error,setError]=useState("Offline · última meta salva");const location=useLocation(),navigate=useNavigate();
window.__menuScenario=next=>{if(next.profile)setProfile(next.profile);if(next.theme){setTheme(next.theme);document.documentElement.className=next.theme==="dark"?"dark":"";}if(next.error)setError(next.error);};window.__androidBack=dismissTopOptionModal;window.__route=()=>location;window.__navigate=(state)=>navigate("/admin/fleet",{state});
const close=()=>{setOpen(false);setAccount(false);setCompanySwitch(false);};const noop=()=>{};
return <div className="nvu-native-android nvu-workspace-shell nvu-admin-shell nvu-central-shell" style={{minHeight:"100vh"}}>
<button id="trigger" onClick={()=>setOpen(true)}>Abrir menu</button><button id="underlying" onClick={()=>window.__underlying=(window.__underlying||0)+1} style={{position:"fixed",left:0,bottom:0}}>Ação da página</button>
<GlobalMenu profile={profile} nativeAndroid open={open} onClose={close} currentUserName="David Canto" roleLabel={profile==="company"?"Administrador":"Motorista"} activeRole={profile==="company"?"admin":"driver"} canSwitchRole onSwitchRole={close} isProfileMenuOpen={account} onToggleProfile={()=>setAccount(v=>!v)} showCompanySwitch={companySwitch} onShowCompanySwitch={setCompanySwitch} availableCompanies={[{companyId:"dc",companyName:"DC Transportes",roles:["admin","driver"]}]} activeCompanyId="dc" onCompanySwitch={close} onProfileEdit={close} theme={theme} onToggleTheme={()=>{const next=theme==="dark"?"light":"dark";setTheme(next);document.documentElement.className=next==="dark"?"dark":"";}} onLogout={close} driverItems={DRIVER_MENU_ITEMS} companyGroups={COMPANY_MENU_GROUPS}/>
<div className="nvu-central-page nvu-central-stack"><ManagementDashboard periodLabel="Outubro 2026" periodDescription="Mês atual" onPeriod={noop} earnings={["R$ 673.026,00"]} tripCount={31} goal={{amount:"R$ 1.000.000,00",progress:67.3,loading:false,error,canEdit:true,onRetry:()=>{window.__retry=(window.__retry||0)+1;}}} onGoal={noop} operations={[]} totalOperations={0} onAction={noop} onInfo={noop} onDriver={noop} loading={false} refreshing={false}/></div></div>}
createRoot(document.getElementById("root")).render(<MemoryRouter initialEntries={[{pathname:"/admin/fleet",state:{activeTab:"operations"}}]}><App/></MemoryRouter>);
`},bundle:true,write:false,format:"iife",platform:"browser",jsx:"automatic",loader:{".css":"empty"},define:{"process.env.NODE_ENV":'"test"'},plugins:[{name:"isolate-secondary-ports",setup(plugin){
plugin.onResolve({filter:/\/lib\/routePreload$/},()=>({path:"preload",namespace:"fixture"}));plugin.onLoad({filter:/.*/,namespace:"fixture"},()=>({contents:"export const preloadRoute=async()=>{};",loader:"js"}));
plugin.onLoad({filter:/src\/components\/admin\/management\/ManagementOperationCard.tsx$/},()=>({contents:"export function ManagementOperationCard(){return null;}",loader:"tsx"}));
plugin.onLoad({filter:/src\/components\/common\/StableImage.tsx$/},()=>({contents:"export const StableImage=()=>null;",loader:"tsx"}));
}}]});
const html=`<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><style>${css}</style></head><body><div id="root"></div><script>${result.outputFiles[0].text.replace(/<\/script/gi,"<\\/script")}</script></body></html>`;
const server=http.createServer((req,res)=>{res.writeHead(200,{"Content-Type":"text/html"});res.end(html);});await new Promise(resolve=>server.listen(0,"127.0.0.1",resolve));
const browser=await playwright.chromium.launch({headless:true,...process.env.NVU_CHROMIUM_EXECUTABLE?{executablePath:process.env.NVU_CHROMIUM_EXECUTABLE}:{},args:["--no-sandbox","--disable-dev-shm-usage"]});
const context=await browser.newContext({viewport:{width:390,height:867}}),page=await context.newPage(),errors=[],cases=[];
page.on("pageerror",error=>errors.push(String(error)));
await context.route("**/*",route=>new URL(route.request().url()).hostname==="127.0.0.1"?route.continue():route.abort());
const check=async(name,fn)=>{await fn();cases.push({name,result:"PASS"});console.log(`PASS ${name}`);};
const open=()=>page.locator("#trigger").click();
const menu=()=>page.getByRole("dialog");
try{
await page.goto(`http://127.0.0.1:${server.address().port}/`);await page.locator(".nvu-central-goal").waitFor();
for(const theme of ["light","dark"])for(const width of [320,390,412,768]){
await page.setViewportSize({width,height:867});await page.evaluate(theme=>window.__menuScenario({theme}),theme);
await check(`Meta compacta, separada da barra e alinhada à direita: ${width}/${theme}`,async()=>{
const geometry=await page.locator(".nvu-central-goal").evaluate(card=>{const bar=card.querySelector(".nvu-central-progress").getBoundingClientRect(),button=card.querySelector(".nvu-central-goal-feedback button").getBoundingClientRect(),bounds=card.getBoundingClientRect();return {gap:button.top-bar.bottom,height:button.height,right:bounds.right-button.right,overflow:card.scrollWidth>card.clientWidth};});
assert(geometry.gap>=7,JSON.stringify(geometry));assert(geometry.height<=30,JSON.stringify(geometry));assert(geometry.right>=8&&geometry.right<=16,JSON.stringify(geometry));assert.equal(geometry.overflow,false);
});
for(const profile of ["driver","company"]){await page.evaluate(profile=>window.__menuScenario({profile}),profile);await open();await menu().waitFor();
await check(`Menu sem atalhos duplicados, sem corte e com contraste: ${profile}/${width}/${theme}`,async()=>{
const content=await menu().innerText();assert(!/Relatórios|Ranking|NVU News/.test(content));assert(content.includes("Manual"));
const bounds=await menu().boundingBox();assert(bounds.x>=-1&&bounds.y>=0&&bounds.x+bounds.width<=width+1&&bounds.y+bounds.height<=867);
assert.equal(await menu().evaluate(node=>node.scrollWidth<=node.clientWidth),true);
assert.equal(await menu().getByRole("switch",{name:"Alternar modo escuro"}).getAttribute("aria-checked"),theme==="dark"?"true":"false");
});
if(width===390)await page.screenshot({path:path.join(output,`menu-${profile}-${theme}.png`)});
await page.keyboard.press("Escape");await menu().waitFor({state:"hidden"});}
}
await page.setViewportSize({width:390,height:867});await page.evaluate(()=>window.__menuScenario({profile:"company",theme:"light"}));
await check("Estrutura da Frota abre a aba de frota e destaca apenas essa aba",async()=>{
await open();const link=menu().getByRole("link",{name:"Estrutura da Frota"});assert(!(await link.getAttribute("class")).includes("is-active"));await link.click();
await page.waitForFunction(()=>window.__route().state?.activeTab==="fleet");await open();assert((await link.getAttribute("class")).includes("is-active"));await page.keyboard.press("Escape");
});
await check("Tab permanece no menu; Escape fecha e restaura o foco",async()=>{await open();const links=menu().getByRole("button",{name:"Sair",exact:true});await links.focus();await page.keyboard.press("Tab");assert.equal(await menu().evaluate(node=>node.contains(document.activeElement)),true);await page.keyboard.press("Escape");assert.equal(await page.locator("#trigger").evaluate(node=>node===document.activeElement),true);});
await check("Voltar Android fecha o menu sem navegar e restaura rolagem",async()=>{await open();assert.equal(await page.evaluate(()=>document.body.style.overflow),"hidden");assert.equal(await page.evaluate(()=>window.__androidBack()),true);await menu().waitFor({state:"hidden"});assert.notEqual(await page.evaluate(()=>document.body.style.overflow),"hidden");});
await check("Toque fora fecha sem acionar o botão por baixo",async()=>{await open();await page.locator("#underlying").click({force:true});await menu().waitFor({state:"hidden"});assert.equal(await page.evaluate(()=>window.__underlying||0),0);await page.locator("#underlying").click();assert.equal(await page.evaluate(()=>window.__underlying),1);});
await check("Atualizar meta preserva a ação funcional",async()=>{await page.getByRole("button",{name:"Atualizar meta",exact:true}).click();assert.equal(await page.evaluate(()=>window.__retry),1);});
assert.deepEqual(errors,[]);
await fs.writeFile("reports/workspace-menu-503-ui.json",JSON.stringify({cases,productionAccess:false,widths:[320,390,412,768],themes:["light","dark"],method:"Real GlobalMenu, production navigation entries, ManagementDashboard and built CSS; isolated remote adapters."},null,2)+"\n");
console.log(`WORKSPACE_503_UI ${cases.length}/${cases.length} PASS`);
}finally{await browser.close();await new Promise(resolve=>server.close(resolve));}
