import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { build } from "esbuild";

// The component mounted by Dashboard, with the built production stylesheet.
// No Firebase, native bridge or external network is initialized in this test.
let playwright;
try { playwright = await import("playwright"); }
catch { playwright = await import(pathToFileURL(path.join(process.env.CODEX_PRIMARY_RUNTIME_NODE_MODULES, "playwright/index.mjs")).href); }
const root = process.cwd(), results = [], errors = [];
const assets = await fs.readdir("dist/assets");
const names = ["vendor", "index", "DriverWorkspace"].flatMap(prefix => assets.filter(n => n.startsWith(prefix + "-") && n.endsWith(".css")));
assert(names.some(n => n.startsWith("DriverWorkspace-")), "Run npm run build first");
const css = (await Promise.all(names.map(n => fs.readFile(path.join("dist/assets", n), "utf8")))).join("\n");
const bundle = await build({ stdin: { sourcefile: "timing-qa.tsx", resolveDir: root, loader: "tsx", contents: `
import React,{useState} from "react";import {createRoot} from "react-dom/client";
import {DriverOperationTiming} from "./src/components/driver/DriverOperationTiming";
window.__starts=0;function App(){const [state,set]=useState({remaining:"2d · 15h · 42min",disabled:false,busy:false});window.__timing=set;
return <main className="nvu-workspace-theme nvu-driver-workspace" style={{padding:16}}>
<header className="nvu-driver-page-heading" data-page="dashboard"><div><h1>Operação atual</h1><p>Acompanhe suas entregas e o prazo.</p></div></header>
<article style={{background:"var(--driver-paper)",borderRadius:12}}>
<DriverOperationTiming {...state} onStart={()=>window.__starts++}/></article></main>;}
createRoot(document.getElementById("root")).render(<App/>);` }, bundle: true, write: false, format: "iife", platform: "browser", jsx: "automatic",
  define: { "process.env.NODE_ENV": '"test"' } });
const html = `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>${css}</style></head><body><div id="root"></div><script>${bundle.outputFiles[0].text.replace(/<\/script/gi,"<\\/script")}</script></body></html>`;
const browser = await playwright.chromium.launch({ headless: true,
  ...(process.env.NVU_CHROMIUM_EXECUTABLE ? { executablePath: process.env.NVU_CHROMIUM_EXECUTABLE } : {}), args: ["--no-sandbox", "--disable-dev-shm-usage"] });
try {
  const context = await browser.newContext();
  await context.route("**/*", async route => {
    const u = new URL(route.request().url());
    assert.equal(u.hostname,"127.0.0.1","Only isolated local assets are allowed");
    if (u.pathname.startsWith("/assets/")) return route.fulfill({body:await fs.readFile(path.join(root,"public",u.pathname)),contentType:"font/woff2"});
    return route.fulfill({body:html,contentType:"text/html"});
  });
  const page = await context.newPage(); page.on("pageerror", error => errors.push(error.message));
  await page.goto("http://127.0.0.1:43829/"); await page.getByTestId("driver-operation-timing").waitFor();
  await page.evaluate(() => document.fonts.ready);
  for (const width of [320,360,390,412,768,1280]) for (const dark of [false,true]) for (const remaining of ["2d · 15h · 42min","365d · 23h · 59min","Atrasado","Não definido"]) {
    await page.setViewportSize({width,height:400});
    await page.evaluate(({dark,remaining}) => {document.documentElement.classList.toggle("dark",dark);window.__timing({remaining,disabled:false,busy:false});}, {dark,remaining});
    await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    const geometry = await page.getByTestId("driver-operation-timing").evaluate(row => {
      const rect = r => ({left:r.left,right:r.right,width:r.width,height:r.height,cx:(r.left+r.right)/2,cy:(r.top+r.bottom)/2,top:r.top,bottom:r.bottom});
      const nodes = [...row.children];
      const clock=nodes[0].querySelector("svg"), label=nodes[0].querySelector("div");
      const icon=nodes[1].querySelector("svg");
      return {row:rect(row.getBoundingClientRect()),cells:nodes.map(n=>rect(n.getBoundingClientRect())),
        clock:rect(clock.getBoundingClientRect()), label:rect(label.getBoundingClientRect()), textAlign:getComputedStyle(nodes[0]).textAlign,
        icon:{fill:getComputedStyle(icon).fill,color:getComputedStyle(icon).color},
        visibleText:row.textContent,
        animation:getComputedStyle(nodes[1],"::after").animationDuration,
        overflow:document.documentElement.scrollWidth>innerWidth,
        // The clipped reflection intentionally crosses the button's scroll
        // bounds. Inspect its label, not that decorative overflow.
        textOverflow:[row,...nodes.filter(n=>n.tagName!=="BUTTON"),...row.querySelectorAll("strong,small,span")].some(n=>n.scrollWidth>n.clientWidth+1),
        fonts:nodes.map(n=>({font:getComputedStyle(n).font,scroll:n.scrollWidth,width:n.clientWidth,
          text:[...n.querySelectorAll("strong,small,span")].map(t=>({text:t.textContent,font:getComputedStyle(t).font,width:t.getBoundingClientRect().width,scroll:t.scrollWidth}))}))};
    });
    assert(!geometry.overflow && !geometry.textOverflow,JSON.stringify({width,dark,remaining,geometry}));
    assert.equal(geometry.cells.length,2,"Only remaining time and the start button are displayed");
    assert(!/Prazo limite|22\/10\/2026/.test(geometry.visibleText),"The removed deadline cannot reserve a visible column");
    assert(Math.abs(geometry.cells[0].width-geometry.cells[1].width)<1,"Time card and start button have equal widths");
    assert(Math.abs(geometry.cells[0].height-geometry.cells[1].height)<1,"Time card and start button have equal heights");
    if(remaining.startsWith("2d")) assert(geometry.cells[0].height<=48,"The usual remaining-time value keeps the approved compact height");
    assert(geometry.cells[0].right<geometry.cells[1].left,"The two tiles retain a gap");
    assert(geometry.cells.every(c=>Math.abs(c.cy-geometry.cells[0].cy)<1),"Time card and action stay aligned on one row");
    assert(geometry.clock.width>0 && geometry.clock.height>0,"The clock stays visible even on small screens");
    assert(Math.abs((geometry.clock.left+geometry.label.right)/2-geometry.cells[0].cx)<1,"The clock and remaining-time text are centered together");
    assert.equal(geometry.textAlign,"center","Remaining-time label and value use centered text");
    assert.equal(geometry.icon.fill,geometry.icon.color,"The start icon is fully filled with its accent color");
    assert.notEqual(geometry.icon.fill,"none");
    assert.equal(geometry.animation,"3s","The reflection repeats every three seconds");
    results.push({width,dark,remaining,result:"PASS",tileWidth:geometry.cells[0].width,tileHeight:geometry.cells[0].height});
    if(width===390 && remaining.startsWith("2d")) {
      await fs.mkdir("verification/operation-timing",{recursive:true});
      for(const [phase,time] of [["quiet",2400],["reflection",1000]]) {
        await page.getByRole("button",{name:"Iniciar trabalho",exact:true}).evaluate(async (button,time)=>{
          const a=button.getAnimations({subtree:true}).find(a=>a.animationName==="nvu-operation-start-reflection");a.pause();a.currentTime=time;
          await new Promise(resolve=>requestAnimationFrame(resolve));
        },time);
        await page.screenshot({path:`verification/operation-timing/${dark?"dark":"light"}-${phase}-390.png`});
      }
    }
  }
  await page.getByRole("button",{name:"Iniciar trabalho",exact:true}).click();
  assert.equal(await page.evaluate(()=>window.__starts),1);
  const reflection = await page.getByRole("button",{name:"Iniciar trabalho",exact:true}).evaluate(async button => {
    const animation=button.getAnimations({subtree:true}).find(a=>a.animationName==="nvu-operation-start-reflection");
    if(!animation)throw new Error("The start button must have an actual CSS reflection animation");
    animation.pause();
    const sample=async time=>{
      animation.currentTime=time;
      await new Promise(resolve=>requestAnimationFrame(resolve));
      const s=getComputedStyle(button,"::after");
      return {time,transform:s.transform,opacity:Number(s.opacity),pointerEvents:s.pointerEvents};
    };
    const samples=[];for(const time of [650,1050,2400,3650])samples.push(await sample(time));
    animation.currentTime=0;animation.play();
    return {samples,overflow:getComputedStyle(button).overflow};
  });
  assert(reflection.samples[0].opacity>0 && reflection.samples[1].opacity>0,"The sweep is visible while crossing the button");
  assert.notEqual(reflection.samples[0].transform,reflection.samples[1].transform,"The reflection moves across the button");
  assert.equal(reflection.samples[2].opacity,0,"A quiet interval separates the sweeps");
  assert.equal(reflection.samples[0].transform,reflection.samples[3].transform,"The sweep position repeats after exactly 3000ms");
  assert.equal(reflection.overflow,"hidden","Reflection stays clipped to the button");
  assert(reflection.samples.every(s=>s.pointerEvents==="none"),"Reflection cannot intercept the start action");
  await page.evaluate(()=>window.__timing({remaining:"2d · 15h · 42min",disabled:true,busy:true}));
  await page.getByRole("button",{name:"Preparando…",exact:true}).waitFor();
  assert(await page.getByRole("button",{name:"Preparando…",exact:true}).isDisabled());
  assert.equal(await page.getByRole("button",{name:"Preparando…",exact:true}).evaluate(b=>getComputedStyle(b,"::after").animationName),"none");
  await page.evaluate(()=>window.__timing({remaining:"2d · 15h · 42min",disabled:false,busy:true}));
  await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(resolve)));
  assert.equal(await page.getByRole("button",{name:"Preparando…",exact:true}).evaluate(b=>getComputedStyle(b,"::after").animationName),"none","Busy state stops the reflection even when the caller has not disabled the button");
  await page.evaluate(()=>window.__timing({remaining:"2d · 15h · 42min",disabled:false,busy:false}));
  await page.getByRole("button",{name:"Iniciar trabalho",exact:true}).waitFor();
  await page.emulateMedia({reducedMotion:"reduce"});
  assert.equal(await page.getByRole("button",{name:"Iniciar trabalho",exact:true}).evaluate(b=>getComputedStyle(b,"::after").animationName),"none","Reduced motion suppresses the reflection");
  assert.deepEqual(errors,[]);
  await fs.mkdir("reports",{recursive:true});
  await fs.writeFile("reports/operation-timing-visual.json",JSON.stringify({result:"PASS",browser:browser.version(),productionAccess:false,
    scope:"Actual Dashboard timing component + production CSS; no physical-device latency claim",results,reflection,
    checks:["start action","disabled and busy states","3000ms reflection cycle","moving highlight clipped to the button","filled start icon","centered remaining-time group","clock visible at 320px","reduced motion"]},null,2));
  console.log(`OPERATION_TIMING_VISUAL_PASS (${results.length} layouts + action/disabled/reflection/reduced-motion checks)`);
} finally {await browser.close();}
