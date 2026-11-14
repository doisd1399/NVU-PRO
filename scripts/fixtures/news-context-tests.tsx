import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import assert from "node:assert/strict";
import NewsFeed, { warmNvuNewsFirstPage } from "../../src/pages/NewsFeed";
import NewsFeedView from "../../src/pages/NewsFeedView";
import { formatNewsMoney } from "../../src/lib/newsMoney";
import { newsSimulatorAliases, newsSimulatorKey, resolveNewsSessionSimulator } from "../../src/lib/newsSimulator";
import { ports } from "./news-context-ports";

const gto = { id: "gto-company", name: "DC Transportes", simulatorId: "GTO", simulatorName: "GTO", status: "active" };
const toe3 = { id: "toe-company", name: "Outra empresa", simulatorId: "TOE3", simulatorName: "TOE 3", status: "active" };
const catalog = [{ id: "GTO", name: "Global Truck Online" }, { id: "TOE3", name: "Truckers of Europe 3" }];
const brl = (amount: number) => new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(amount);
const eur = (amount: number) => new Intl.NumberFormat("pt-BR", { style: "currency", currency: "EUR" }).format(amount);
let root: Root | null = null;
let serial = 0;
const loadCompanyCatalog = async () => {};
const pause = () => new Promise(resolve => setTimeout(resolve, 0));
async function render() {
  await act(async () => { root!.render(<NewsFeed />); });
  await act(async () => { await pause(); });
}
async function mount(role = "driver", extra: any = {}, cachedPosts?: any[], cacheAge = 0) {
  if (root) await act(async () => root!.unmount());
  document.body.innerHTML = '<div id="root"></div>';
  window.localStorage.clear(); window.sessionStorage.clear();
  ports.session = { currentUser: { id: `news-test-${++serial}`, companyId: toe3.id, simulatorId: "TOE3", simulatorName: "TOE 3" }, activeRole: role };
  ports.company = { activeCompanyId: gto.id, companies: [toe3, gto], allCompanies: [toe3, gto],
    companyCatalogLoaded: true, companyCatalogAttempted: true, loadCompanyCatalog, ...extra };
  ports.simulators = catalog;
  ports.queries = []; ports.readResult = null; ports.readError = null;
  if (cachedPosts) window.localStorage.setItem(`nvu_news_feed_v10_consistent_metrics:${ports.session.currentUser.id}:noticias:all:gto`,
    JSON.stringify({ savedAt: Date.now() - cacheAge, posts: cachedPosts, hasMore: false }));
  root = createRoot(document.getElementById("root")!);
  await render();
}
const feedQueries = () => ports.queries.filter(item => item.collection === "nvu_classificacoes");
function assertOnlySimulator(key: string, excluded: string) {
  const requests = feedQueries();
  assert(requests.length > 0, "News must actually query the selected simulator");
  for (const request of requests) {
    const constraint = request.constraints.find((item: any) => item.field === "simuladorKey");
    assert(constraint, "A scoped News request must include the simulator: " + JSON.stringify(request));
    const values = Array.isArray(constraint.value) ? constraint.value : [constraint.value];
    assert(values.includes(key), JSON.stringify(values));
    assert(!values.includes(excluded), JSON.stringify(values));
  }
}

export async function run() {
  const cases: { name: string; result: string }[] = [];
  async function test(name: string, body: () => any) {
    await body(); cases.push({ name, result: "PASS" }); console.log(`PASS ${name}`);
  }
  try {
    await test("GTO legado sem moeda exibe ganhos reais em BRL", () => {
      assert.equal(formatNewsMoney({ ganhos: 40704 }, { simulador: "GTO" }), brl(40704));
    });
    await test("TOE3 legado usa EUR e não herda o simulador do leitor", () => {
      assert.equal(formatNewsMoney({ ganhos: 1234.56 }, { simuladorKey: "toe3" }), eur(1234.56));
    });
    await test("Aliases históricos de GTO, WTDS, WBDS e TOE3 usam a política compartilhada", () => {
      for (const simulator of ["Global Truck", "Global Truck Online", "WTDS", "World Bus Driving Simulator", "com.stargamesapps.gto"])
        assert.equal(formatNewsMoney({ ganhos: 100 }, { simulador: simulator }), brl(100), simulator);
      assert.equal(formatNewsMoney({ ganhos: 100 }, { simulador: "Truckers of Europe 3" }), eur(100));
    });
    await test("Moeda explícita, símbolos e valores legados com vírgula são preservados", () => {
      assert.equal(formatNewsMoney({ ganhos: "40.704,00", moeda: "R$" }), brl(40704));
      assert.equal(formatNewsMoney({ ganhos: "1,234.56", currency: "EUR" }), eur(1234.56));
      assert.equal(formatNewsMoney({ ganhos: 20 }, { moeda: "EUR" }), eur(20));
    });
    await test("Ganhos em centavos têm precedência e zero continua sendo um valor válido", () => {
      assert.equal(formatNewsMoney({ ganhos: 99, earningsCents: 12345 }, { simulador: "GTO" }), brl(123.45));
      assert.equal(formatNewsMoney({ ganhos: 0 }, { simulador: "GTO" }), brl(0));
    });
    await test("Moeda do participante tem precedência sobre o agregado", () => {
      assert.equal(formatNewsMoney({ ganhos: 10, moeda: "EUR" }, { currency: "BRL", moeda: "BRL" }), eur(10));
    });
    await test("Simulador opaco da publicação é resolvido no catálogo", () => {
      assert.equal(formatNewsMoney({ ganhos: 120 }, { simuladorId: "AbcDefGh123456789XYZ" }, [{ id: "AbcDefGh123456789XYZ", name: "GTO" }]), brl(120));
    });
    await test("Sem identidade conhecida não inventa moeda nem valor zero", () => {
      assert.equal(formatNewsMoney({ ganhos: 10 }, { simulador: "Outro simulador" }), "Moeda não informada");
      for (const ganhos of [undefined, null, "", "não informado", NaN, Infinity, -10])
        assert.equal(formatNewsMoney({ ganhos }, { simulador: "GTO", ganhos: 500 }), "Valor indisponível");
    });
    await test("Moedas e simuladores conflitantes não recebem um símbolo incorreto", () => {
      assert.equal(formatNewsMoney({ ganhos: 10, currency: "EUR" }, { simulador: "GTO" }), "Moedas conflitantes");
      assert.equal(formatNewsMoney({ ganhos: 10, simulatorCode: "TOE3" }, { simulador: "GTO" }), "Moedas conflitantes");
      assert.equal(formatNewsMoney({ ganhos: 10, moeda: "EUR", currency: "BRL" }), "Moedas conflitantes");
    });
    await test("Totais por moeda não são somados entre si e totais incompletos ficam indisponíveis", () => {
      assert.equal(formatNewsMoney({ currencyTotals: { BRL: 10, EUR: 20 } }), `${brl(10)} · ${eur(20)}`);
      assert.equal(formatNewsMoney({ ganhos: 10, currencyMissingValueTrips: 1 }, { simulador: "GTO" }), "Valor indisponível");
    });
    await test("Nome da pessoa ou empresa não vira simulador", () => {
      assert.equal(resolveNewsSessionSimulator({ currentUser: { name: "David Canto" } }).key, "");
      assert.equal(resolveNewsSessionSimulator({ activeCompanyId: "company", companies: [{ id: "company", name: "DC Transportes" }] }).key, "");
    });
    await test("Aliases conhecidos produzem uma única chave canônica", () => {
      assert.equal(newsSimulatorKey("Global Truck"), "gto");
      assert.equal(newsSimulatorKey("TOE 3"), "toe3");
      assert(newsSimulatorAliases("Truckers of Europe 3").includes("toe3"));
    });
    await test("Empresa ativa prevalece sobre cadastro e catálogo antigo", () => {
      const selected = resolveNewsSessionSimulator({ activeCompanyId: gto.id, currentUser: { companyId: toe3.id, simulatorId: "TOE3" },
        allCompanies: [toe3, { ...gto, simulatorId: "TOE3", simulatorName: "TOE 3" }], companies: [gto], simulators: catalog });
      assert.equal(selected.key, "gto"); assert(!selected.aliases.includes("toe3"));
    });
    await test("Conta sem empresa usa o próprio simulador e empresa pendente aguarda hidratação", () => {
      assert.equal(resolveNewsSessionSimulator({ currentUser: { simulatorId: "TOE3" } }).key, "toe3");
      const pending = resolveNewsSessionSimulator({ activeCompanyId: gto.id, currentUser: { simulatorId: "TOE3" } });
      assert.equal(pending.key, ""); assert.equal(pending.pending, true);
    });
    await test("ID opaco aguarda catálogo e catálogo encerrado permite alternativa sem travar o feed", () => {
      const companies = [{ id: "c", simulatorId: "AbcDefGh123456789XYZ" }];
      assert.equal(resolveNewsSessionSimulator({ activeCompanyId: "c", companies }).pending, true);
      assert.equal(resolveNewsSessionSimulator({ activeCompanyId: "c", companies, catalogSettled: true }).pending, false);
      assert.equal(resolveNewsSessionSimulator({ activeCompanyId: "c", companies,
        simulators: [{ id: "AbcDefGh123456789XYZ", name: "GTO" }] }).key, "gto");
    });
    for (const role of ["admin", "driver"]) await test(`Primeira consulta do ${role} usa o painel ativo sem misturar aliases`, async () => {
      await mount(role);
      assert.equal(ports.captured.selectedSimulator, "gto");
      assertOnlySimulator("gto", "toe3");
    });
    await test("Troca de empresa atualiza o simulador antes da próxima consulta", async () => {
      await mount(); ports.queries = [];
      ports.company = { ...ports.company, activeCompanyId: toe3.id };
      await render(); assert.equal(ports.captured.selectedSimulator, "toe3"); assertOnlySimulator("toe3", "gto");
    });
    await test("Filtro manual é preservado no painel e reiniciado ao trocar empresa", async () => {
      await mount();
      await act(async () => { ports.captured.onSimulatorChange("all"); await pause(); });
      assert.equal(ports.captured.selectedSimulator, "all");
      await render(); assert.equal(ports.captured.selectedSimulator, "all");
      ports.company = { ...ports.company, activeCompanyId: toe3.id }; ports.queries = [];
      await render(); assert.equal(ports.captured.selectedSimulator, "toe3"); assertOnlySimulator("toe3", "gto");
    });
    await test("Troca de perfil não reaproveita filtro manual do outro perfil", async () => {
      await mount("admin");
      await act(async () => { ports.captured.onSimulatorChange("toe3"); await pause(); });
      ports.session = { ...ports.session, activeRole: "driver" };
      await render(); assert.equal(ports.captured.selectedSimulator, "gto");
    });
    await test("Atualização do simulador da própria empresa reinicia o filtro manual", async () => {
      await mount();
      await act(async () => { ports.captured.onSimulatorChange("all"); await pause(); });
      ports.company = { ...ports.company, companies: [toe3, { ...gto, simulatorId: "TOE3", simulatorName: "TOE 3" }] };
      ports.queries = [];
      await render(); assert.equal(ports.captured.selectedSimulator, "toe3"); assertOnlySimulator("toe3", "gto");
    });
    await test("Empresa carregada depois não dispara consulta com simulador antigo", async () => {
      await mount("driver", { companies: [], allCompanies: [], companyCatalogLoaded: false, companyCatalogAttempted: false });
      assert.equal(feedQueries().length, 0);
      ports.company = { ...ports.company, companies: [gto], companyCatalogLoaded: true };
      await render(); assert.equal(ports.captured.selectedSimulator, "gto"); assertOnlySimulator("gto", "toe3");
    });
    await test("Cache existente mantém a publicação legada e corrige a moeda sem baixar novamente", async () => {
      const post = { id: "legacy-gto", tipo: "classificacao", entidade: "motorista", simulador: "GTO", simuladorKey: "gto",
        periodoTipo: "semana", periodoInicioKey: "2026-10-11", periodoFimKey: "2026-10-17",
        topMotoristas: [{ id: "jose", nome: "José Macedo", empresaId: gto.id, viagens: 22, ganhos: 40704 }] };
      await mount("driver", {}, [post]);
      assert.equal(ports.captured.filteredPosts.length, 1);
      assert.equal(feedQueries().filter(item => item.method === "getDocs").length, 0);
      const cached = ports.captured.filteredPosts[0];
      assert.equal(formatNewsMoney(cached.topMotoristas[0], cached, ports.captured.simulators), brl(40704));
    });
    const offlinePost = { id: "offline-legacy", tipo: "classificacao", entidade: "motorista", titulo: "Destaques José", simulador: "GTO", simuladorKey: "gto",
      periodoTipo: "semana", periodoInicioKey: "2026-10-11", periodoFimKey: "2026-10-17", topMotoristas: [{ id: "jose", nome: "José Macedo", empresaId: gto.id, viagens: 22, ganhos: 40704 }] };
    const network = async (online: boolean) => { await act(async () => { Object.defineProperty(navigator, "onLine", {value: online, configurable:true}); window.dispatchEvent(new Event(online ? "online" : "offline")); await pause(); }); };
    await test("Offline preserva publicação com mais de 24 horas e encerra carregamento", async () => {
      await network(false); await mount("driver", {}, [offlinePost], 3 * 86400000);
      assert.equal(ports.captured.filteredPosts.length, 1); assert.equal(ports.captured.loading, false);
      assert.match(ports.captured.feedError, /Offline/); assert.equal(feedQueries().length, 0);
    });
    await test("Filtros semanais reutilizam a consulta local sem exigir visita prévia", async () => {
      await act(async () => { ports.captured.onPeriodFilterChange("semana"); await pause(); });
      assert.equal(ports.captured.filteredPosts.length, 1); assert.equal(feedQueries().length, 0);
    });
    await test("Pesquisa longa funciona no conteúdo salvo sem esvaziar o feed", async () => {
      await act(async () => { ports.captured.onSearchChange("José"); await pause(); });
      assert.equal(ports.captured.filteredPosts.length, 1); assert.equal(ports.captured.searching, false);
      await act(async () => { ports.captured.onSearchChange("Ausente"); await pause(); });
      assert.equal(ports.captured.filteredPosts.length, 0);
      await act(async () => { ports.captured.onSearchChange(""); await pause(); });
      assert.equal(ports.captured.filteredPosts.length, 1);
    });
    await test("Sem cache offline mostra ausência de dados salvos sem spinner infinito", async () => {
      await mount(); assert.equal(ports.captured.loading, false); assert.equal(ports.captured.filteredPosts.length, 0);
      assert.match(ports.captured.feedError, /salvas/); assert.equal(feedQueries().length, 0);
    });
    await test("Retorno online atualiza leitura antiga, preservando o conteúdo quando a rede falha", async () => {
      await mount("driver", {}, [offlinePost], 3 * 86400000);
      ports.readError = Object.assign(new Error("Rede temporariamente indisponível"), {code:"unavailable"});
      const warn = console.error; console.error = () => {};
      try { await network(true); await act(async () => { await pause(); }); } finally { console.error = warn; }
      assert.equal(ports.captured.filteredPosts.length, 1); assert.equal(ports.captured.loading, false);
      assert.match(ports.captured.feedError, /salvo/); ports.readError = null;
    });
    await test("Voltar à página e focar a janela não repete a consulta ainda recente", async () => {
      await mount("driver", {}, [offlinePost]);
      await act(async () => { window.dispatchEvent(new Event("focus")); await pause(); });
      assert.equal(feedQueries().filter(item => item.method === "getDocs").length, 0);
      await act(async () => root!.unmount()); root = createRoot(document.getElementById("root")!); await render();
      assert.equal(ports.captured.filteredPosts.length, 1);
      assert.equal(feedQueries().filter(item => item.method === "getDocs").length, 0);
    });
    await test("Resposta vazia confirmada no servidor remove publicação antiga", async () => {
      await act(async () => { ports.captured.onRefresh(); await pause(); });
      assert.equal(ports.captured.filteredPosts.length, 0);
    });
    await test("Aquecimento do cache usa a mesma empresa ativa", async () => {
      ports.warmup = true; ports.queries = [];
      const selected = resolveNewsSessionSimulator({ activeCompanyId: gto.id, currentUser: ports.session.currentUser, companies: [toe3, gto], simulators: catalog });
      await warmNvuNewsFirstPage({ userId: `warm-news-${++serial}`, simulatorValues: [selected.key, ...selected.aliases] });
      assertOnlySimulator("gto", "toe3"); ports.warmup = false;
    });
    await test("Cards e legendas reais exibem BRL/EUR no feed de todos os simuladores", () => {
      const makePost = (simulador: string, entidade: string) => ({ id: `${simulador}-${entidade}`, tipo: "classificacao", entidade,
        titulo: "Destaque", simulador, periodoTipo: "semana", periodo: "11/10/2026 a 17/10/2026", periodoInicioKey: "2026-10-11", periodoFimKey: "2026-10-17",
        [entidade === "motorista" ? "topMotoristas" : "topEmpresas"]: [1, 2, 3].map(posicao => ({ id: `${posicao}`, nome: `Participante ${posicao}`, posicao, viagens: 22,
          ganhos: posicao * 1200, empresaNome: "MATECOM" })) });
      const markup = renderToStaticMarkup(<NewsFeedView {...ports.captured} loading={false} loadingMore={false} filteredPosts={[makePost("GTO", "motorista"), makePost("TOE 3", "empresa")]}
        selectedSimulator="all" activeSimulatorLabel="Todos os simuladores" simulators={catalog} />);
      const element = document.createElement("div"); element.innerHTML = markup;
      const content = element.textContent || "";
      assert(!content.includes("Moeda não informada"));
      assert(content.split(brl(1200)).length >= 4, "Caption, winner and ranking must use the same BRL formatter");
      assert(content.split(eur(1200)).length >= 4, "The second post must retain its own EUR");
      assert(content.includes(brl(3600))); assert(content.includes(eur(3600)));
    });
    return cases;
  } finally {
    if (root) await act(async () => root!.unmount());
    root = null;
  }
}
