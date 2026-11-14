import React, {act} from "react";
import {createRoot, type Root} from "react-dom/client";
import {MemoryRouter} from "react-router-dom";
import assert from "node:assert/strict";
import RecruitmentTab from "../../src/pages/admin/fleet/RecruitmentTab";
import {useCompanyRecruitmentController} from "../../src/context/CompanyContext";
import {pageCacheKey, readPageSnapshot, writePageSnapshot, coalescePageRead, withReadDeadline, isReadFresh} from "../../src/lib/pageReadCache";
import {ports, auth, snapshot, publish} from "./offline-pages-503-ports";

const pause = () => new Promise(resolve => setTimeout(resolve, 0));
const row = (id: string, companyId = "dc", status = "approved") => ({id,companyId,status,fullName:`Pessoa ${id}`,email:`${id}@example.test`,createdAt:"2026-10-10T10:00:00Z",type:"driver_application"});
let root: Root | null = null, controller: ReturnType<typeof useCompanyRecruitmentController>;
function Controller() { controller = useCompanyRecruitmentController({userId:ports.viewer,userEmail:"admin@example.test",activeRole:"admin",targetCompanyId:ports.companyId,isActive:true}); return <output>{controller.recruitmentApplications.map(app=>app.fullName).join("|")}</output>; }
async function mount(kind = "page") {
  if (root) await act(async () => root!.unmount());
  document.body.innerHTML = '<div id="root"></div>'; root = createRoot(document.getElementById("root")!);
  await render(kind);
}
async function render(kind = "page") { await act(async () => {publish();root!.render(<MemoryRouter>{kind === "controller" ? <Controller/> : <RecruitmentTab/>}</MemoryRouter>); await pause();}); }
async function network(value: boolean) { await act(async () => {Object.defineProperty(navigator,"onLine",{value,configurable:true});window.dispatchEvent(new Event(value?"online":"offline"));await pause();}); }
const historyKey = () => pageCacheKey(ports.viewer,"recruitment-history",ports.companyId);
const pendingKey = () => pageCacheKey(ports.viewer,"recruitment-pending",`company:${ports.companyId}`);

export async function run() {
  const cases: {name:string;result:string}[] = [];
  const test = async (name: string, body:()=>any) => {await body();cases.push({name,result:"PASS"});console.log(`PASS ${name}`);};
  try {
    await test("Cache não mistura conta, empresa ou finalidade", () => {
      localStorage.clear(); writePageSnapshot(historyKey(),{rows:[row("one")],hasMore:false});
      assert.equal(readPageSnapshot<any>(historyKey())?.value.rows[0].id,"one");
      assert.equal(readPageSnapshot(pageCacheKey("admin-b","recruitment-history","dc")),null);
      assert.equal(readPageSnapshot(pageCacheKey("admin-a","recruitment-history","second")),null);
      assert.equal(readPageSnapshot(pendingKey()),null);
    });
    await test("Histórico salvo há três dias reabre offline sem consulta nem carregamento infinito", async () => {
      writePageSnapshot(historyKey(),{rows:[row("one")],hasMore:false},Date.now()-3*86400000);
      await network(false); await mount();
      assert(document.body.textContent?.includes("Pessoa one")); assert(!document.body.textContent?.includes("Carregando histórico")); assert.equal(ports.queries.length,0);
    });
    await test("Outra empresa sem cache não herda dados privados nem inventa histórico vazio do servidor", async () => {
      ports.companyId="second"; await render(); assert(!document.body.textContent?.includes("Pessoa one"));
      assert(document.body.textContent?.includes("Nenhum histórico salvo")); assert.equal(ports.queries.length,0);
    });
    await test("Reconexão atualiza o histórico apenas quando necessário", async () => {
      ports.companyId="dc";ports.rows=[row("two")];await render(); await network(true);
      assert(document.body.textContent?.includes("Pessoa two"));assert(!document.body.textContent?.includes("Pessoa one"));
      const count=ports.queries.length;await mount(); await act(async()=>{window.dispatchEvent(new Event("focus"));await pause();});
      assert.equal(ports.queries.length,count);assert(document.body.textContent?.includes("Pessoa two"));
    });
    await test("Falha de rede não apaga a última leitura válida", async () => {
      await act(async()=>root!.unmount());root=null;
      writePageSnapshot(historyKey(),{rows:[row("two")],hasMore:false},Date.now()-180000);
      ports.error={code:"unavailable"}; await mount();
      assert(document.body.textContent?.includes("Pessoa two"));assert(document.body.textContent?.includes("Não foi possível atualizar"));
      assert(!document.body.textContent?.includes("Carregando histórico"));ports.error=null;
    });
    await test("Resposta tardia da empresa anterior não modifica a empresa ativa", async () => {
      let resolve:any;ports.deferred=new Promise(r=>{resolve=r;});
      await mount(); ports.companyId="second";ports.deferred=null;ports.rows=[];await render();
      await act(async()=>{resolve(snapshot([row("late")]));await pause();});
      assert(!document.body.textContent?.includes("Pessoa late"));assert.equal(readPageSnapshot<any>(historyKey())?.value.rows.length,0);
    });
    await test("Resposta vazia autoritativa substitui o histórico anterior", async () => {
      ports.companyId="dc";writePageSnapshot(historyKey(),{rows:[row("old")],hasMore:false},Date.now()-180000);ports.rows=[];await mount();
      assert(!document.body.textContent?.includes("Pessoa old"));assert.deepEqual(readPageSnapshot<any>(historyKey())?.value.rows,[]);
    });
    await test("Revogação de acesso remove o histórico privado salvo", async () => {
      writePageSnapshot(historyKey(),{rows:[row("revoked")],hasMore:false},Date.now()-180000);ports.error={code:"permission-denied"};await mount();
      assert(!document.body.textContent?.includes("Pessoa revoked"));assert.equal(readPageSnapshot(historyKey()),null);ports.error=null;
    });
    await test("Controller reabre candidatos salvos e ignora snapshot parcial vazio do SDK", async () => {
      writePageSnapshot(pendingKey(),[row("pending","dc","pending")]);await network(false);await mount("controller");
      assert(document.body.textContent?.includes("Pessoa pending"));
      const listener=[...ports.listeners].find(entry=>entry.ref.collection==="recruitment_applications");assert(listener);
      await act(async()=>{listener.callback(snapshot([],true));await pause();});
      assert(document.body.textContent?.includes("Pessoa pending"));
      await act(async()=>{listener.callback(snapshot([]));await pause();});
      assert(!document.body.textContent?.includes("Pessoa pending"));assert.deepEqual(readPageSnapshot<any[]>(pendingKey())?.value,[]);
    });
    await test("Controller não publica callback de uma empresa já abandonada", async () => {
      const old=[...ports.listeners].find(entry=>entry.ref.collection==="recruitment_applications");
      ports.companyId="second";await render("controller");
      await act(async()=>{old.callback(snapshot([row("wrong","dc","pending")]));await pause();});
      assert(!document.body.textContent?.includes("Pessoa wrong"));
    });
    await test("Cache corrompido e armazenamento bloqueado não impedem a página", () => {
      localStorage.setItem(historyKey(),"not-json");assert.equal(readPageSnapshot(historyKey()),null);
      const method=Object.getPrototypeOf(localStorage).setItem;Object.getPrototypeOf(localStorage).setItem=()=>{throw new Error("quota");};
      try {writePageSnapshot(historyKey(),{rows:[]});} finally {Object.getPrototypeOf(localStorage).setItem=method;}
    });
    await test("Consultas simultâneas compartilham transporte e uma falha permite nova tentativa", async () => {
      await network(true);let calls=0;let resolve:any;
      const task=()=>{calls++;return new Promise<number>(r=>{resolve=r;});};
      const a=coalescePageRead("dedupe",task),b=coalescePageRead("dedupe",task);assert.equal(a,b);await pause();assert.equal(calls,1);resolve(7);assert.equal(await b,7);
      await assert.rejects(coalescePageRead("retry",async()=>{throw new Error("network");}));
      assert.equal(await coalescePageRead("retry",async()=>9),9);
    });
    await test("Consulta sem resposta tem prazo e cache antigo continua válido para uso offline", async () => {
      await assert.rejects(withReadDeadline(new Promise(()=>{}),5),/esgotado/);
      writePageSnapshot(historyKey(),{rows:[row("stale")]},Date.now()-86400000);
      const cached=readPageSnapshot<any>(historyKey());assert(cached);assert.equal(isReadFresh(cached.savedAt),false);assert.equal(cached.value.rows.length,1);
    });
    return cases;
  } finally {if(root)await act(async()=>root!.unmount());root=null;}
}
