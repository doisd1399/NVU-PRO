import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const srcRoot = path.join(root, "src");
const androidRoot = path.join(root, "android");
const outPath = path.join(root, "AUDITORIA-ARQUITETURAL-WEB-APK.md");

const walk = (dir) => {
  if (!fs.existsSync(dir)) return [];
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  return entries.flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return walk(full);
    return /\.(ts|tsx|java|gradle|xml)$/.test(entry.name) ? [full] : [];
  });
};

const files = walk(srcRoot);
const rel = (file) => path.relative(root, file).replaceAll(path.sep, "/");
const read = (file) => fs.readFileSync(file, "utf8");
const all = files.map((file) => ({ file, rel: rel(file), text: read(file) }));

const patterns = {
  use_effect: /\buseEffect\s*\(/g,
  use_layout_effect: /\buseLayoutEffect\s*\(/g,
  firebase_queries: /\b(?:getDocs|getDoc|getCountFromServer|onSnapshot|collection|query|where|orderBy|limit|startAfter)\s*\(/g,
  realtime_listeners: /\bonSnapshot\s*\(/g,
  loading: /\b(?:loading|isLoading|loadingUser|loadingProfile|loadingData|loadingAuth|loadingInitial|isInitializing|isHydrating|sessionRecovering|operationalDataRefreshing|globalTripsLoading)\b/gi,
  local_storage: /\b(?:localStorage|sessionStorage)\b/g,
  firestore: /\b(?:firebase|Firestore|firestore|collectionGroup|writeBatch|runTransaction)\b/g,
  filters: /\.(?:filter|find|some|every)\s*\(/g,
  sorting: /\.(?:sort|orderBy)\s*\(/g,
  navigation: /\b(?:navigate|useNavigate|redirect|Navigate)\b/g,
  subscriptions: /\b(?:subscribe|unsubscribe|addListener|removeListener|onAuthStateChanged|onIdTokenChanged)\b/g,
};

const count = (text, re) => (text.match(re) || []).length;
const totals = Object.fromEntries(Object.entries(patterns).map(([key, re]) => [key, all.reduce((sum, item) => sum + count(item.text, re), 0)]));

const pageFiles = all.filter(({ rel: file }) => file.startsWith("src/pages/") && file.endsWith(".tsx"));
const contextFiles = all.filter(({ rel: file }) => file.includes("context") || file.includes("contexts") || file.includes("providers"));
const hookFiles = all.filter(({ rel: file }) => file.includes("/hooks/"));
const repositoryFiles = all.filter(({ rel: file }) => file.includes("/repositories/") || file.includes("/services/"));

const rows = (items) => items.map(({ rel: file, text }) => {
  const q = count(text, patterns.firebase_queries);
  const listeners = count(text, patterns.realtime_listeners);
  const loading = count(text, patterns.loading);
  const cache = count(text, patterns.local_storage);
  const effects = count(text, patterns.use_effect) + count(text, patterns.use_layout_effect);
  const filters = count(text, patterns.filters);
  const navigation = count(text, patterns.navigation);
  return `| \`${file}\` | ${q} | ${listeners} | ${effects} | ${loading} | ${cache} | ${filters} | ${navigation} |`;
}).join("\n");

const top = (items, re, label) => items
  .map((item) => ({ file: item.rel, n: count(item.text, re) }))
  .filter(({ n }) => n > 0)
  .sort((a, b) => b.n - a.n)
  .slice(0, 25)
  .map(({ file, n }) => `| \`${file}\` | ${n} |`)
  .join("\n") || `| — | 0 |`;

const report = `# Auditoria arquitetural Web × APK

**Data da auditoria:** ${new Date().toISOString()}  
**Projeto:** NVU operacional  
**Escopo:** inventário estático da árvore Web/TypeScript e dos pontos Android/Capacitor; nenhuma regra de negócio foi alterada por este auditor.

## 1. Resumo executivo

A base utiliza uma Web React/TypeScript compartilhada com o APK Capacitor local-first. A inicialização combina persistência Firebase Auth, projeções visuais UID-scoped, AppContext, providers de sessão/perfil, rota persistida e listeners Firestore. O principal risco arquitetural é que prontidão visual, autorização e disponibilidade de dados operacionais ainda aparecem em módulos diferentes; por isso uma consulta secundária pode continuar gerando estados de loading mesmo quando existe snapshot local suficiente para a primeira pintura.

A auditoria quantitativa abaixo deve ser lida como evidência de superfície do código, não como medição de rede ou de tempo físico. Nenhum teste de aparelho foi realizado nesta etapa.

## 2. Inventário quantitativo

| Métrica | Quantidade |
|---|---:|
${Object.entries(totals).map(([key, value]) => `| ${key} | ${value} |`).join("\n")}
| Arquivos TypeScript/TSX analisados | ${all.length} |
| Páginas TSX | ${pageFiles.length} |
| Contextos/providers | ${contextFiles.length} |
| Hooks | ${hookFiles.length} |
| Repositórios/serviços | ${repositoryFiles.length} |

## 3. Matriz de páginas e módulos

| Arquivo | Chamadas/query | Listeners | Effects | Estados/loading | Storage | Filtros | Navegação |
|---|---:|---:|---:|---:|---:|---:|---:|
${rows(pageFiles)}

## 4. Contextos, hooks e serviços com maior superfície de efeitos

### Effects e listeners

| Arquivo | Effects/listeners |
|---|---:|
${top(all, patterns.use_effect, "Effects")}

### Queries/listeners Firebase

| Arquivo | Ocorrências |
|---|---:|
${top(all, patterns.firebase_queries, "Queries")}

### Loading e bloqueios

| Arquivo | Ocorrências |
|---|---:|
${top(all, patterns.loading, "Loading")}

### Persistência

| Arquivo | Ocorrências |
|---|---:|
${top(all, patterns.local_storage, "Storage")}

## 5. Achados prioritários

### CRÍTICO — entrada e perfil ativo

A restauração de rota precisa ser condicionada ao UID e ao perfil ativo persistido. Uma rota protegida não pode ser restaurada apenas por existir no storage; deve ser considerada compatível com o papel escolhido. Quando não houver perfil ativo, o seletor é a superfície correta. Quando houver perfil ativo válido, a entrada pública não deve exigir nova escolha nem bloquear em reconciliação visual.

### CRÍTICO — autorização versus pintura

sessionUiReady e sessionReady precisam permanecer semanticamente separados. Snapshot local pode pintar shell, seletor, operação e histórico; somente Auth Firebase coerente e membership canônica podem autorizar ações protegidas. Qualquer componente que use sessionReady para decidir se pode pintar dados conhecidos cria bloqueio real.

### ALTO — operação ativa e histórico

A operação ativa, viagens e indicadores devem usar projeções persistidas e escopadas por UID/empresa/simulador apenas para a primeira pintura. Listener Firestore e contratos/catálogos devem atualizar em background. Snapshot não pode conceder permissão, misturar empresas ou ser usado após troca/logout.

### ALTO — listeners e efeitos

Os maiores contadores de effects, queries e listeners devem ser revisados para garantir que mudanças de aba, filtros e remontagens não recriem listeners sem necessidade. O estado de cache deve ser lido antes de registrar listeners, e o primeiro snapshot autoritativo deve substituir a projeção somente quando pertencer ao mesmo escopo.

### MÉDIO — filtragem e ordenação

Filtros e ordenações repetidos em página, contexto e subcomponente aumentam trabalho de renderização. A otimização segura é mover filtros invariantes para uma projeção escopada/reutilizável, sem remover filtros funcionais nem ampliar a consulta Firebase além do necessário.

## 6. Web × APK

| Processo | Web | APK | Avaliação |
|---|---|---|---|
| Autenticação | Firebase Web persistence + provider | Mesmo bundle Web dentro do WebView + plugin nativo como fallback | Mesmo código de superfície; lifecycle Android pode reconstruir WebView |
| Restauração | localStorage/session route + Auth | localStorage dentro do WebView + lifecycle Capacitor | Deve usar o mesmo snapshot UID-scoped |
| Perfil | Provider/AppContext/SelectProfile | Mesmo bundle local | Sem divergência funcional desejada |
| Operação/histórico | hooks e listeners Firestore | Mesmo bundle local; rede pode estar indisponível na abertura | Cache local deve pintar primeiro |
| OTA | Site/manifesto | Cliente Capawesome consulta canal do versionCode | Canal precisa coincidir com o APK |
| Autorização | Firebase Auth + memberships | Mesmo contrato via WebView | Nunca liberar por cache visual |

## 7. Classificação de loading

| Classe | Regra de aplicação |
|---|---|
| A — obrigatório | Login/Auth sem identidade; ação protegida sem autorização; primeira consulta sem snapshot algum |
| B — parcial | Catálogo, ranking ou contrato secundário que afeta apenas uma seção |
| C — desnecessário | Bloquear seletor, shell ou histórico porque uma reconciliação secundária ainda está pendente |
| D — redundante | Overlay global e skeleton local cobrindo a mesma consulta |
| E — arquiteturalmente incorreto | Perder snapshot ao fechar WebView e reconstruir todo o bootstrap mesmo com sessão/perfil/rota conhecidos |

## 8. Arquitetura recomendada

A inicialização segura e rápida deve seguir: restaurar Firebase Auth; ler snapshot UID-scoped; restaurar perfil ativo e rota compatível; pintar shell e dados conhecidos; confirmar membership em paralelo; iniciar listeners somente para o escopo atual; substituir projeções locais por snapshots autoritativos; invalidar somente no logout, troca de UID, troca de empresa ou TTL vencido.

O primeiro login deve criar apenas o contexto mínimo necessário, mostrar a superfície de seleção e carregar dados essenciais em paralelo. Conta já autenticada deve evitar o caminho de primeiro login e usar warm boot. Navegação interna deve preservar caches e listeners por escopo, em vez de reconstruir o bootstrap completo.

## 9. Plano incremental

| Fase | Ação | Risco |
|---|---|---|
| Fundação | Consolidar activeRole, rota, UID, empresa e snapshot versionado | Mistura entre contas se a chave não for UID-scoped |
| Dados | Deduplicar listeners, escopar queries e usar stale-while-revalidate | Dados obsoletos se TTL/invalidação não forem explícitos |
| Interface | Remover gates globais; manter loading apenas na seção sem dados | Ações protegidas não podem usar o cache como autorização |
| APK | Validar recriação WebView, foreground/background e canal OTA | Sem aparelho, só gates estáticos não comprovam o ciclo real |
| Validação | Primeiro login, conta logada, fechamento, reabertura, troca de perfil, offline/reconexão | Requer teste físico para confirmação final |

## 10. Próximas ações recomendadas

A próxima implementação deve ser incremental. Primeiro devem ser adicionados gates que comprovem UID, empresa e perfil em cada snapshot; em seguida devem ser instrumentados listeners para contar criação/destruição e escopo; por fim, cada loading deve ser reclassificado como A/B/C/D/E e removido somente quando houver snapshot equivalente e autorização protegida preservada.

Nenhuma query ou regra de negócio deve ser removida apenas por parecer redundante. A confirmação deve usar logs de escopo, testes de troca de conta, logout, reconexão e paridade Web/APK.
`;

fs.writeFileSync(outPath, report);
console.log(`AUDIT_REPORT=${outPath}`);
console.log(JSON.stringify({ totals, pages: pageFiles.length, contexts: contextFiles.length, hooks: hookFiles.length, repositories: repositoryFiles.length }, null, 2));
