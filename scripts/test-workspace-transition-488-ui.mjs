import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { build } from "esbuild";
let playwright;
try { playwright = await import("playwright"); }
catch { playwright = await import(pathToFileURL(path.join(process.env.CODEX_PRIMARY_RUNTIME_NODE_MODULES,"playwright/index.mjs")).href); }
const root=process.cwd();
const bundle=await build({stdin:{resolveDir:root,loader:"tsx",sourcefile:"transition-488.tsx",contents:`
import React,{useState,lazy,Suspense} from "react";import {createRoot} from "react-dom/client";
import {MemoryRouter,Routes,Route,useNavigate} from "react-router-dom";
import {commitRoleVisualTransition} from "./src/lib/roleVisualTransition";
import {installDeployRecovery} from "./src/lib/deployRecovery";
import {StartupRecovery} from "./src/components/common/StartupRecovery";
window.__fetches=0;window.fetch=async()=>{window.__fetches++;return {ok:true,json:async()=>({buildId:"changed"})};};
installDeployRecovery();
let finish;const Admin=lazy(()=>new Promise(resolve=>{finish=()=>resolve({default:()=> <article data-testid="admin">Empresa pronta</article>});}));
function App(){const [role,setRole]=useState("driver"),[failed,setFailed]=useState(false);const navigate=useNavigate();
window.__switch=target=>commitRoleVisualTransition(target,()=>{setRole(target);navigate("/"+target);});window.__finish=()=>finish();window.__fail=()=>setFailed(true);
if(failed)return <StartupRecovery onRetry={()=>setFailed(false)}/>;
return <><input aria-label="Campo responsivo"/><output>{role}</output><Suspense fallback={<div data-testid="fallback">Abrindo...</div>}><Routes><Route path="/driver" element={<article data-testid="driver">Motorista pronto</article>}/><Route path="/admin" element={<Admin/>}/></Routes></Suspense></>;}
createRoot(document.getElementById("root")).render(<MemoryRouter initialEntries={["/driver"]}><App/></MemoryRouter>);
`},bundle:true,write:false,format:"iife",platform:"browser",jsx:"automatic",define:{"process.env.NODE_ENV":'"test"'},plugins:[{name:"native-platform",setup(b){b.onResolve({filter:/^@capacitor\/core$/},()=>({path:"capacitor",namespace:"native-fixture"}));b.onLoad({filter:/.*/,namespace:"native-fixture"},()=>({contents:'export const Capacitor={isNativePlatform:()=>true};'}));}}]});
const html=`<!doctype html><html lang="pt-BR"><body><div id="root"></div><script>${bundle.outputFiles[0].text.replace(/<\/script/gi,"<\\/script")}</script></body></html>`;
const browser=await playwright.chromium.launch({headless:true,...(process.env.NVU_CHROMIUM_EXECUTABLE?{executablePath:process.env.NVU_CHROMIUM_EXECUTABLE}:{}),args:["--no-sandbox","--disable-dev-shm-usage"]});
try{
 const page=await browser.newPage();const errors=[];page.on("pageerror",e=>errors.push(e.message));
 await page.route("**/*",r=>r.fulfill({body:html,contentType:"text/html"}));await page.goto("http://127.0.0.1:43831/");await page.getByTestId("driver").waitFor();
 await page.evaluate(()=>window.__switch("admin"));
 await page.evaluate(()=>new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r))));
 assert(await page.getByTestId("driver").isVisible(),"The source workspace stays visible while the new profile chunk is pending");assert.equal(await page.getByTestId("fallback").count(),0);
 await page.getByRole("textbox",{name:"Campo responsivo"}).fill("continua responsivo");
 await page.evaluate(()=>window.__switch("driver"));await page.evaluate(()=>window.__finish());await page.waitForTimeout(50);
 assert(await page.getByTestId("driver").isVisible(),"A later choice wins over an older delayed destination");
 await page.evaluate(()=>window.__switch("admin"));await page.getByTestId("admin").waitFor();
 assert.equal(await page.getByRole("textbox").inputValue(),"continua responsivo");
 await page.evaluate(()=>{window.dispatchEvent(new Event("focus"));document.dispatchEvent(new Event("visibilitychange"));window.dispatchEvent(new ErrorEvent("error",{message:"Failed to fetch dynamically imported module"}));});
 await page.waitForTimeout(2200);assert.equal(await page.evaluate(()=>window.__fetches),0,"Native resume cannot poll web builds or force an asset reload");
 assert(await page.getByTestId("admin").isVisible());
 await page.evaluate(()=>window.__fail());await page.getByRole("alert").waitFor();await page.getByRole("button",{name:"Tentar novamente"}).click();await page.getByTestId("admin").waitFor();
 assert.deepEqual(errors,[]);await fs.mkdir("reports",{recursive:true});
 await fs.writeFile("reports/workspace-transition-488.json",JSON.stringify({result:"PASS",browser:browser.version(),checks:["pending profile keeps visible source","responsive urgent input","last profile choice wins","destination resolves","native resume does not poll/reload","startup recovery action"],productionAccess:false,physicalDeviceTested:false},null,2));
 console.log("WORKSPACE_TRANSITION_488_UI_PASS 6 checks");
}finally{await browser.close();}
