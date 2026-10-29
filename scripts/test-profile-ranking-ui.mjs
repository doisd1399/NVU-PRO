import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { build } from "esbuild";

// Render the real cards and useProfileRanking; only remote adapters are fixtures.
// No authenticated session or production Firebase reads are used by this test.
const root = process.cwd();
const outputDir = path.resolve(
  process.env.NVU_QA_OUTPUT_DIR || "qa-profile-ranking",
);
await fs.mkdir(outputDir, { recursive: true });
let playwright;
try {
  playwright = await import("playwright");
} catch {
  if (!(process.env.NVU_QA_NODE_MODULES || process.env.CODEX_PRIMARY_RUNTIME_NODE_MODULES))
    throw new Error(
      "Instale playwright e Chromium para executar este teste de interface.",
    );
  playwright = await import(
    pathToFileURL(
      path.join(
        (process.env.NVU_QA_NODE_MODULES || process.env.CODEX_PRIMARY_RUNTIME_NODE_MODULES),
        "playwright/index.mjs",
      ),
    ).href
  );
}

const fixtureModule = `
import { normalizeTrip } from "./src/lib/tripNormalizer";
import { parseRankingAggregateDocument } from "./src/lib/rankingAggregates";
export const simulatorId = "catalog-gto-id-opaque-001";
export const simulators = [{ id: simulatorId, name: "GTO" }];
export const companies = [
  { id: "matecom", companyName: "MATECOM" }, { id: "cocal", companyName: "COCAL TRANSPORTE" },
  { id: "tijoleira", companyName: "Tijoleira Transportes" }, { id: "dc", companyName: "DC Transportes" },
  { id: "cooper", companyName: "Cooper log Transporte e Logística" },
  { id: "bramila", companyName: "Bramila" }, { id: "dalavan", companyName: "Dalavan Construções" },
].map(c => ({ ...c, simulatorId, status: "active" }));
export const users = [
  { id: "jose", name: "José Macedo", companyId: "matecom" }, { id: "thiago", name: "Thiago Caetano", companyId: "matecom" },
  { id: "ferreira", name: "José Ferreira", companyId: "cocal" }, { id: "davi", name: "Davi Canto", companyId: "dc" },
  { id: "dudu", name: "Dudu tv", companyId: "matecom" }, { id: "gleyfson", name: "Gleyfson Silva", companyId: "matecom" },
  { id: "roberto", name: "Roberto Santos", companyId: "matecom" }, { id: "colleague", name: "Colega Acima", companyId: "dc" },
  { id: "zero", name: "Colega Sem Viagens", companyId: "dc" },
];
export const members = ["davi", "colleague", "zero"].map(userId => ({userId,companyId:"dc",status:"active",roles:["driver"]}));
export const rawOwnTrips = Array.from({ length: 8 }, (_, i) => ({id:"own-"+i,companyId:"dc",driverId:"davi",simulatorId,status:"concluida",valor:i===7?104873:0,completedAt:i<4?"2026-10-01T12:00:00Z":"2026-10-02T12:00:00Z"}));
export const scopedTrips = [...rawOwnTrips,{id:"colleague-trip",companyId:"dc",driverId:"colleague",simulatorId:"gto",status:"concluida",valor:150000,completedAt:"2026-10-02T12:00:00Z"}].map(normalizeTrip);
export function aggregate(options) {
  const companyStats = {matecom:{val:1192503,trips:48},cocal:{val:126253,trips:5},tijoleira:{val:125168,trips:5},dc:{val:104873,trips:8},cooper:{val:23460,trips:1},bramila:{val:0,trips:0},dalavan:{val:0,trips:0}};
  const driverStats = {jose:{val:634600,trips:24,companyId:"matecom",name:"José Macedo"},thiago:{val:497436,trips:20,companyId:"matecom",name:"Thiago Caetano"},ferreira:{val:126253,trips:5,companyId:"cocal",name:"José Ferreira"},davi:{val:104873,trips:8,companyId:"dc",name:"Davi Canto"},dudu:{val:93399,trips:4,companyId:"matecom",name:"Dudu tv"},gleyfson:{val:60467,trips:4,companyId:"matecom",name:"Gleyfson Silva"},roberto:{val:31769,trips:1,companyId:"matecom",name:"Roberto Santos"}};
  const scenario=window.__rankingScenario;
  if(scenario==="zero") driverStats.davi={...driverStats.davi,val:0,trips:0};
  if(scenario==="tie") driverStats.ferreira={...driverStats.ferreira,val:104873,trips:9};
  const payload = {schemaVersion:4,simulatorId:options.simulatorId,periodType:options.periodType,periodKey:options.periodKey,periodTimeZone:"America/Sao_Paulo",periodPolicy:"SAO_PAULO_CALENDAR",complete:true,sourceTripCount:66,
    companies:scenario==="empty"?{}:scenario==="single"?{dc:companyStats.dc}:companyStats,
    drivers:scenario==="empty"?{}:scenario==="single"?{davi:driverStats.davi}:driverStats};
  return parseRankingAggregateDocument(payload);
}
export function useRankingAggregate(options) {
  window.__rankingQueries.push({kind:"aggregate",...options});
  const scenario=window.__rankingScenario;
  return {key:options.periodKey,aggregate:options.enabled?aggregate(options):null,status:!options.enabled?"idle":scenario==="error"?"unavailable":scenario==="loading"?"loading":"ready",error:scenario==="error"?new Error("fixture offline"):null};
}
export function useRankingCompaniesByIds(ids, enabled) {
  const pending=window.__rankingScenario==="metadata-pending";
  return {companies:enabled?companies.filter(c=>ids.includes(c.id) && !(window.__rankingScenario==="missing-company"&&c.id==="dc")):[],loading:false,refreshing:false,complete:!pending&&ids.length>0,serverConfirmed:!pending&&ids.length>0,error:null};
}
export function useRankingUsersRealtime(ids, enabled) { return {users:enabled?users.filter(u=>ids.includes(u.id)):[],loading:false,refreshing:false,error:null}; }
export function useTripsRealtime(options) {
  window.__rankingQueries.push({kind:"trips",...options});
  const partial=window.__rankingScenario==="internal-pending";
  return {trips:options.enabled?scopedTrips:[],loading:false,refreshing:false,serverConfirmed:Boolean(options.enabled&&!partial),error:null};
}
export function useLiveCalendarReference() { return new Date("2026-10-04T12:00:00Z"); }
export function useRankingFilterStore() { return {setGlobalPeriodPreset:(value)=>{window.__rankingPeriod=value;}}; }
`;

const fixtureHooks = new Set([
  "useRankingAggregate.ts",
  "useRankingCompaniesByIds.ts",
  "useRankingUsersRealtime.ts",
  "useTripsRealtime.ts",
  "useLiveCalendarReference.ts",
  "AppContext.tsx",
]);
const bundle = await build({
  stdin: {
    contents: `
import React, { useState } from "react";
import { createRoot } from "react-dom/client";
import { MemoryRouter, Routes, Route, useLocation } from "react-router-dom";
import { DriverPerformanceCard } from "./src/components/DriverPerformanceCard";
import { CompanyPerformanceCard } from "./src/components/CompanyPerformanceCard";
import { HistoryMoneySummary } from "./src/components/common/HistoryMoneySummary";
import { OperationResultModal } from "./src/components/OperationResultModal";
import { companies,simulators,users,members,rawOwnTrips,simulatorId } from "profile-ranking-fixtures";
function Destination() {const location=useLocation();window.__rankingNavigation=location.state;return <div id="ranking-destination">Ranking completo</div>;}
function Profile() {
  const [scenario,setScenario]=useState("ready");const [subject,setSubject]=useState("driver");
  window.__rankingScenario=scenario;window.__setRankingScenario=setScenario;window.__setRankingSubject=setSubject;
  if(scenario==="operation"||scenario==="operation-unknown") {const groups=scenario==="operation"?[{currency:"BRL",currencyStatus:"known",value:500,tripCount:3},{currency:"EUR",currencyStatus:"known",value:200,tripCount:2}]:undefined;return <OperationResultModal isOpen onClose={()=>{}} onRequestNewJob={()=>{}} resultData={{contractName:"BLS-10",tempoExecucao:"10h",tempoRestante:"2h",isAtrasado:false,prazoTotal:"30 dias",totalViagens:5,totalGanhos:700,moneyGroups:groups}}/>;}
  return <main className="max-w-[520px] mx-auto p-3 sm:p-5"><header className="mb-5 text-slate-900 dark:text-white"><p className="font-bold text-xl">NVU</p><p className="text-sm mt-1">{subject==="driver"?"Davi Canto":"DC Transportes"} · GTO</p><p className="text-[10px] text-slate-500 mt-1">Prévia com dados de teste</p></header>{subject==="driver"?<DriverPerformanceCard key="driver" historicoTrips={rawOwnTrips} driverId="davi" activeCompanyId="dc" allCompanyMembers={members} users={users} currentUser={users.find(u=>u.id==="davi")} simulatorId={simulatorId} allCompanies={[...companies]} simulators={simulators} displayLevel={17} currentLevelXp={300} xpProgress={30}/>:<CompanyPerformanceCard key="company" historicoTrips={rawOwnTrips} companyId="dc" allCompanies={[...companies]} simulatorId={simulatorId} simulators={simulators}/>} {scenario==="multi"&&<section aria-label="Resumo compacto"><span>VIAGENS 5</span><span>GANHOS</span><HistoryMoneySummary groups={[{currency:"BRL",currencyStatus:"known",value:500,tripCount:3},{currency:"EUR",currencyStatus:"known",value:200,tripCount:2}]} totalEligibleTrips={5}/></section>}</main>;
}
window.__rankingQueries=[];
createRoot(document.getElementById("root")).render(<MemoryRouter><Routes><Route path="/" element={<Profile/>}/><Route path="/ranking" element={<Destination/>}/></Routes></MemoryRouter>);
`,
    resolveDir: root,
    sourcefile: "profile-ranking-ui-fixture.tsx",
    loader: "tsx",
  },
  bundle: true,
  write: false,
  format: "iife",
  platform: "browser",
  jsx: "automatic",
  loader: { ".css": "empty" },
  define: { "process.env.NODE_ENV": '"test"' },
  plugins: [
    {
      name: "bounded-ranking-fixtures",
      setup(plugin) {
        plugin.onResolve({ filter: /^profile-ranking-fixtures$/ }, () => ({
          path: "fixtures",
          namespace: "nvu-fixture",
        }));
        plugin.onLoad({ filter: /.*/, namespace: "nvu-fixture" }, () => ({
          contents: fixtureModule,
          resolveDir: root,
          loader: "ts",
        }));
        plugin.onLoad({ filter: /src\/(hooks|context)\/.*\.tsx?$/ }, (args) =>
          fixtureHooks.has(path.basename(args.path))
            ? {
                contents: 'export * from "profile-ranking-fixtures";',
                resolveDir: root,
                loader: "ts",
              }
            : undefined,
        );
      },
    },
  ],
});

const assets = await fs.readdir(path.join(root, "dist/assets"));
const cssFile = assets.find((file) => /^index-.*\.css$/.test(file));
assert.ok(cssFile, "Execute npm run build antes do teste de interface.");
const css = (await Promise.all(assets.filter(file=>file.endsWith('.css')).sort((a,b)=>Number(!a.startsWith('index-'))-Number(!b.startsWith('index-'))).map(file=>fs.readFile(path.join(root,'dist/assets',file),'utf8')))).join('\n');
const html = `<!doctype html><html class="dark"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>NVU — prévia de perfis</title><style>${css}</style></head><body><div id="root"></div><script>${bundle.outputFiles[0].text.replace(/<\/script/gi, "<\\/script")}</script></body></html>`;
await fs.writeFile(path.join(outputDir, "PERFIS_RANKING_PREVIA.html"), html);
const browser = await playwright.chromium.launch({
  headless: true,
  ...(process.env.NVU_CHROMIUM_EXECUTABLE
    ? { executablePath: process.env.NVU_CHROMIUM_EXECUTABLE }
    : {}),
  args: ["--no-sandbox", "--disable-gpu", "--disable-dev-shm-usage", ...(process.env.NVU_QA_SINGLE_PROCESS==='true'?['--no-zygote','--single-process']:[])],
});
const page = await browser.newPage({
  viewport: { width: 390, height: 844 },
  deviceScaleFactor: 1,
});
const errors = [];
page.on("pageerror", (error) => errors.push(error.message));
await page.route("**/*", (route) => route.abort());
await page.setContent(html);
let checks = 0;
async function check(name, callback) {
  await callback();
  checks++;
  console.log(`PASS ${name}`);
}
async function scenario(value) {
  await page.evaluate(
    (scenario) => window.__setRankingScenario(scenario),
    value,
  );
}
async function contains(text) {
  await page.getByText(text, { exact: true }).first().waitFor();
}
async function absent(text) {
  assert.equal(await page.getByText(text, { exact: true }).count(), 0);
}

try {
  await check(
    "Global real do motorista: posição, ganhos, diferença e proporção",
    async () => {
      await contains("4º de 7 motoristas");
      await contains("R$ 21.380,00");
      await contains("R$ 104.873,00");
      await absent("Subtotal em BRL");
      await absent("Subtotais separados; sem comparação monetária");
      await contains("16,5%");
      await contains("Nível 17");
      await absent("Excelente");
      await absent("Índice final");
      const reads = await page.evaluate(() => window.__rankingQueries);
      assert.ok(
        reads.some(
          (read) =>
            read.kind === "aggregate" &&
            read.enabled &&
            read.periodKey === "mes_2026-10",
        ),
      );
      assert.ok(!reads.some((read) => read.kind === "trips" && read.enabled));
    },
  );
  await page.screenshot({
    path: path.join(outputDir, "PERFIL_MOTORISTA_RANKING.png"),
    fullPage: true,
  });
  await check("Calendário mensal termina em 31/10", async () => {
    assert.equal(await page.locator('span[title^="2026-10-"]').count(), 31);
    assert.equal(await page.locator('span[title^="2026-11-"]').count(), 0);
  });
  await check(
    "Dados comparativos pendentes não pintam posição; histórico próprio continua",
    async () => {
      await scenario("metadata-pending");
      await contains("Confirmando classificação");
      await absent("4º de 7 motoristas");
      assert.equal(
        await page.locator('span[title="2026-10-01: 4 viagens"]').count(),
        1,
      );
    },
  );
  await check(
    "Falha da fonte global não promove o histórico local a liderança",
    async () => {
      await scenario("error");
      await contains("Ranking indisponível");
      await absent("Você lidera este ranking por ganhos.");
      await absent("4º de 7 motoristas");
    },
  );
  await check(
    "Vazio e falta de atividade não geram avaliação competitiva",
    async () => {
      await scenario("empty");
      await contains("Sem classificação no período");
      await scenario("zero");
      await contains("Sem viagens no período");
      await absent("Você lidera este ranking por ganhos.");
    },
  );
  await check("Subtotais BRL/EUR permanecem separados no card de ganhos", async () => {
    await scenario("multi");
    await contains("R$ 500,00");
    await contains("€ 200,00");
    await absent("R$ 700,00");
  });
  await check("Card compacto mostra VIAGENS antes de GANHOS em GTO/BRL", async () => {
    await scenario("ready");
    const tripsBox = await page.getByText("Viagens", { exact: true }).first().boundingBox();
    const earningsBox = await page.getByText("Ganhos", { exact: true }).first().boundingBox();
    assert.ok(tripsBox && earningsBox);
    assert.ok(tripsBox.x < earningsBox.x, "VIAGENS deve ocupar a coluna esquerda");
    await contains("R$ 104.873,00");
  });
  await check("Operação usa card compacto e separa BRL/EUR sem soma cruzada", async () => {
    await scenario("operation");
    await contains("Operação finalizada!");
    await page.waitForTimeout(500);
    await contains("R$ 500,00");
    await contains("€ 200,00");
    await absent("R$ 700,00");
    const tripsBox = await page.getByText("Viagens", { exact: true }).first().boundingBox();
    const earningsBox = await page.getByText("Ganhos", { exact: true }).first().boundingBox();
    assert.ok(tripsBox && earningsBox && tripsBox.x < earningsBox.x);
    await page.screenshot({ path: path.join(outputDir, "OPERACAO_RESUMO_COMPACTO.png"), fullPage: true });
  });
  await check("Operação sem moeda mostra traço, não texto técnico", async () => {
    await scenario("operation-unknown");
    await page.getByLabel("Ganhos sem moeda determinada").waitFor();
    await absent("Moeda não registrada · valor fora de subtotal monetário");
  });
  await check(
    "Empresa removida não é restaurada pelo catálogo em cache",
    async () => {
      await scenario("missing-company");
      await contains("Sem classificação no período");
      await absent("4º de 7 motoristas");
    },
  );
  await check("Único participante recebe contexto explícito", async () => {
    await scenario("single");
    await contains("1º de 1 motorista");
    await contains("Há somente um participante neste ranking.");
    await absent("Você lidera este ranking por ganhos.");
  });
  await check("Empate é descrito como empate financeiro", async () => {
    await scenario("tie");
    await contains("Empate em ganhos. A posição segue o desempate do ranking.");
  });
  await check(
    "Interno muda o grupo e confirma a fonte da empresa",
    async () => {
      await scenario("ready");
      await page
        .getByRole("button", { name: "Ranking Interno", exact: true })
        .click();
      await contains("2º de 3 motoristas");
      await contains("R$ 45.127,00");
      await scenario("internal-pending");
      await contains("Confirmando classificação");
      await absent("2º de 3 motoristas");
      await scenario("ready");
      await contains("2º de 3 motoristas");
    },
  );
  await check("Histórico usa cinco meses incluindo outubro", async () => {
    await page
      .getByRole("button", { name: "Histórico de classificação" })
      .click();
    for (const label of [
      "Out 2026",
      "Set 2026",
      "Ago 2026",
      "Jul 2026",
      "Jun 2026",
    ])
      await contains(label);
  });
  await check("Empresa usa a classificação entre empresas", async () => {
    await page.evaluate(() => window.__setRankingSubject("company"));
    await contains("4º de 7 empresas");
    await contains("R$ 20.295,00");
    await contains("8,8%");
    await absent("Ranking Interno");
  });
  await page.screenshot({
    path: path.join(outputDir, "PERFIL_EMPRESA_RANKING.png"),
    fullPage: true,
  });
  await check("Layout cabe em 320, 390 e 768px nos dois temas", async () => {
    for (const width of [320, 390, 768])
      for (const dark of [true, false]) {
        await page.setViewportSize({ width, height: 844 });
        await page.evaluate(
          (dark) => document.documentElement.classList.toggle("dark", dark),
          dark,
        );
        assert.ok(
          await page.evaluate(
            () => document.documentElement.scrollWidth <= window.innerWidth,
          ),
          `overflow horizontal ${width}px ${dark ? "dark" : "light"}`,
        );
      }
  });
  await check(
    "Ranking completo recebe empresa, período e simulador",
    async () => {
      await page.getByRole('button',{name:'Período do ranking',exact:true}).click();
      await page.getByRole('dialog',{name:'Período do ranking',exact:true}).getByRole('option',{name:'Semana atual',exact:true}).click();
      await page.getByRole("button", { name: "Ver ranking completo" }).click();
      await page.locator("#ranking-destination").waitFor();
      const navigation = await page.evaluate(() => ({
        state: window.__rankingNavigation,
        period: window.__rankingPeriod,
      }));
      assert.deepEqual(navigation.state.profileRanking, {
        type: "entre",
        simulatorId: "catalog-gto-id-opaque-001",
        companyId: "dc",
        periodType: "semana",
      });
    assert.equal(navigation.period, "semana");
    assert.equal(navigation.state.backgroundLocation.pathname, "/");
    },
  );
  // Exercise the real reconciliation hook separately, with deferred RPCs.
  const aggregateProbe = await build({
    stdin: {
      contents: `
import React,{useState} from "react";import {createRoot} from "react-dom/client";
import {useRankingAggregate} from "./src/hooks/useRankingAggregate";
function Probe(){const [key,setKey]=useState("mes_2026-10");window.__setProbeKey=setKey;const result=useRankingAggregate({simulatorId:"catalog-gto-id-opaque-001",periodType:"mes",periodKey:key,enabled:true,refreshOnRead:true});window.__probe=result;return <output>{result.status}</output>;}
createRoot(document.getElementById("root")).render(<Probe/>);
`,
      resolveDir: root,
      loader: "tsx",
    },
    bundle: true,
    write: false,
    platform: "browser",
    format: "iife",
    jsx: "automatic",
    plugins: [
      {
        name: "aggregate-probe",
        setup(plugin) {
          plugin.onLoad(
            { filter: /src\/repositories\/RankingAggregateRepository\.ts$/ },
            () => ({
              contents: `
window.__ensureCalls=[];window.__serverReads=[];window.__probeLegacy=true;
function doc(key){return {schemaVersion:4,simulatorId:"catalog-gto-id-opaque-001",periodType:"mes",periodKey:key,periodTimeZone:"America/Sao_Paulo",periodPolicy:"SAO_PAULO_CALENDAR",complete:true,sourceTripCount:0,companies:{},drivers:{},lastReconciledAt:new Date(Date.now()-1000).toISOString()};}
export function readCachedRankingAggregate(sim,key){return null;}
export function invalidateRankingAggregateCaches(){}
export function listenRankingAggregate(sim,type,key,next){next(window.__probeLegacy?doc(key):null);return()=>{};}
export function ensureRankingAggregate(sim,type,key){return new Promise((resolve,reject)=>{window.__ensureCalls.push({key,resolve,reject});});}
export function readRankingAggregateFromServer(sim,key){window.__serverReads.push(key);return Promise.resolve(doc(key));}
`,
              loader: "ts",
            }),
          );
          plugin.onLoad(
            { filter: /src\/lib\/CanonicalTripUpdateEvent\.ts$/ },
            () => ({
              contents:
                "export function onCanonicalTripUpdated(){return()=>{};}",
              loader: "ts",
            }),
          );
        },
      },
    ],
  });
  await page.clock.install();
  await page.setContent(
    `<div id="root"></div><script>${aggregateProbe.outputFiles[0].text.replace(/<\/script/gi, "<\\/script")}</script>`,
  );
  await check(
    "Contrato v4 completo permanece visível durante a atualização do período aberto",
    async () => {
      await page.waitForFunction(() => window.__probe.status === "ready");
      assert.equal(await page.evaluate(() => window.__probe.aggregate.schemaVersion), 4);
      assert.equal(await page.evaluate(() => window.__ensureCalls.length), 1);
      assert.deepEqual(await page.evaluate(() => window.__serverReads), []);
      await page.evaluate(()=>{window.__ensureCalls=[];});
    },
  );
  await check(
    "Falha de reconciliação encerra loading mesmo com cache",
    async () => {
      await page.evaluate(() => {window.__probeLegacy=false;window.__setProbeKey("mes_2026-11");});
      await page.waitForFunction(() => window.__ensureCalls.length === 1);
      await page.evaluate(() =>
        window.__ensureCalls[0].reject(new Error("fixture RPC error")),
      );
      await page.waitForFunction(() => window.__probe.status === "unavailable");
      assert.equal(await page.evaluate(() => window.__probe.aggregate), null);
    },
  );
  await check(
    "RPC pendente tem limite e pode recuperar quando o servidor responde",
    async () => {
      await page.evaluate(() => window.__setProbeKey("mes_2026-12"));
      await page.waitForFunction(() => window.__ensureCalls.length === 2);
      await page.clock.runFor(12001);
      await page.waitForFunction(() => window.__probe.status === "unavailable");
      await page.evaluate(() =>
        window.__ensureCalls[1].resolve({ status: "rebuilt", success: true }),
      );
      await page.waitForFunction(() => window.__probe.status === "ready");
      assert.equal(
        await page.evaluate(() => window.__probe.aggregate.periodKey),
        "mes_2026-12",
      );
    },
  );
  assert.deepEqual(errors, [], "React não pode lançar erros de renderização.");
  console.log(
    `profile-ranking-ui: ${checks} scenarios passed; previews in ${outputDir}`,
  );
} finally {
  await browser.close();
}
