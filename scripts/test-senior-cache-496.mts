import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
class MemoryStorage {
  data = new Map<string,string>();
  get length(){return this.data.size;} key(i:number){return [...this.data.keys()][i] ?? null;}
  getItem(key:string){return this.data.get(key) ?? null;} setItem(key:string,value:string){this.data.set(key,value);} removeItem(key:string){this.data.delete(key);}
}
const storage = new MemoryStorage();
const browser = Object.assign(new EventTarget(), {localStorage:storage});
Object.assign(globalThis,{window:browser});
const {createSeniorMonthlyMetricsCache,SENIOR_MONTHLY_CACHE_PREFIX} = await import('../src/lib/seniorMonthlyMetricsCache.ts');
const {readSeniorPanelCache,writeSeniorPanelCache,SENIOR_CATALOG_CACHE_PREFIX} = await import('../src/lib/seniorPanelCache.ts');
const {beginAuthTeardown} = await import('../src/lib/authLifecycle.ts');
const {registrationSubmittedDate,registrationSubmissionLabel} = await import('../src/lib/registrationSubmission.ts');
let time = Date.parse('2026-10-22T12:00:00Z'), online = true;
const cache = () => createSeniorMonthlyMetricsCache({storage:()=>storage,now:()=>time,online:()=>online});
const result = (trips=228,earnings=5442683) => ({periodKey:'mes_2026-10',companies:{matecom:{tripCount:trips,earnings},zero:{tripCount:0,earnings:0}}});
const results:string[]=[];
const test = async (name:string,fn:()=>any) => {await fn();results.push(name);console.log('PASS',name);};
const deferred = <T,>()=>{let resolve!:(v:T)=>void;const promise=new Promise<T>(r=>resolve=r);return {promise,resolve};};
let calls=0; const fetchMetrics=async()=>{calls++;return result();};
const first=cache();
await test('Sessão não identificada não consulta agregados',async()=>{await assert.rejects(first.load('',fetchMetrics));assert.equal(calls,0);});
await test('Preserva viagens, ganhos e zeros confirmados',async()=>{const loaded=await first.load('senior',fetchMetrics);assert.equal(loaded.companies.matecom.earnings,5442683);assert.equal(loaded.companies.zero.tripCount,0);assert.equal(first.read('senior')?.companies.missing,undefined);});
await test('Retorno dentro do prazo usa a mesma consulta',async()=>{await first.load('senior',fetchMetrics);await first.load('senior',fetchMetrics);assert.equal(calls,1);});
await test('Nova instância restaura a consulta persistida',async()=>{await cache().load('senior',fetchMetrics);assert.equal(calls,1);});
await test('Reabertura offline mantém todos os agregados',async()=>{online=false;time+=900000;const c=cache();assert.equal((await c.load('senior',fetchMetrics)).companies.matecom.tripCount,228);assert.equal(calls,1);await assert.rejects(c.load('unknown',fetchMetrics));online=true;});
await test('Consultas não vazam entre usuários',async()=>{assert.equal(first.read('other'),null);});
await test('Falha após expiração não apaga a última consulta',async()=>{await assert.rejects(first.load('senior',async()=>{throw Error('offline');}));assert.equal(first.read('senior')?.companies.matecom.tripCount,228);});
await test('Invalidação persiste mesmo fora da página',async()=>{first.invalidate();assert.equal(cache().read('senior')?.stale,true);const c=cache();await c.load('senior',fetchMetrics);assert.equal(calls,2);});
await test('Requisições simultâneas compartilham a mesma Promise',async()=>{const c=cache(),d=deferred<ReturnType<typeof result>>();const a=c.load('dedup',()=>d.promise),b=c.load('dedup',()=>d.promise);assert.equal(a,b);d.resolve(result());await a;});
await test('Invalidação durante consulta descarta resultado anterior',async()=>{const c=cache(),d=deferred<ReturnType<typeof result>>();let count=0;const pending=c.load('race',()=>++count===1?d.promise:Promise.resolve(result(229)));c.invalidate();d.resolve(result(228));assert.equal((await pending).companies.matecom.tripCount,229);assert.equal(count,2);});
await test('Logout bloqueia respostas tardias e limpa armazenamento',async()=>{const c=cache(),d=deferred<ReturnType<typeof result>>();const pending=c.load('logout',()=>d.promise);c.clear();d.resolve(result());await assert.rejects(pending);assert.equal(c.read('logout'),null);assert.equal([...storage.data.keys()].filter(k=>k.startsWith(SENIOR_MONTHLY_CACHE_PREFIX)).length,0);});
await test('Cache corrompido não produz zeros nem números falsos',async()=>{const c=cache(),key=SENIOR_MONTHLY_CACHE_PREFIX+'bad:mes_2026-10';for(const value of ['{invalid',JSON.stringify({version:1,viewerId:'bad',periodKey:'mes_2026-10',savedAt:time,stale:false,companies:{a:{tripCount:-1,earnings:0}}})]){storage.setItem(key,value);assert.equal(c.read('bad'),null);c.invalidate();assert.equal(c.read('bad'),null);}storage.removeItem(key);});
await test('Quota ou modo privado preserva cache em memória',async()=>{const c=createSeniorMonthlyMetricsCache({storage:()=>{throw Error('quota');},now:()=>time,online:()=>true});await c.load('private',async()=>result());assert.equal(c.read('private')?.companies.matecom.tripCount,228);});
await test('Armazenamento mensal é limitado a oito escopos',async()=>{const c=cache();for(let i=0;i<12;i++)await c.load('bounded'+i,async()=>result());assert.equal([...storage.data.keys()].filter(k=>k.startsWith(SENIOR_MONTHLY_CACHE_PREFIX)).length,8);});
await test('Virada mensal usa calendário de São Paulo',async()=>{time=Date.parse('2026-11-01T02:59:59Z');const c=cache();assert.equal(c.period(),'mes_2026-10');await c.load('month',async()=>result());time+=1000;assert.equal(c.period(),'mes_2026-11');assert.equal(c.read('month'),null);await assert.rejects(c.load('month',async()=>result()));});
await test('Data real aceita ISO, Date e Timestamp, sem inventar datas',async()=>{const ms=Date.parse('2026-10-12T18:29:54Z');for(const value of [new Date(ms),new Date(ms).toISOString(),{toDate:()=>new Date(ms)},{seconds:ms/1000,nanoseconds:0},{_seconds:ms/1000}]){assert.equal(registrationSubmittedDate({createdAt:value})?.getTime(),ms);assert.equal(registrationSubmissionLabel({createdAt:value}),'Enviado em 12/10/2026 • 15:29');}for(const value of [undefined,null,'','invalid',{}])assert.equal(registrationSubmittedDate({createdAt:value}),null);assert.equal(registrationSubmissionLabel({}),'Data de envio não informada');assert.equal(registrationSubmittedDate({createdAt:ms,submittedAt:ms+1000})?.getTime(),ms+1000);});
await test('Catálogo offline é isolado e guarda somente campos usados',async()=>{writeSeniorPanelCache('viewer',{companies:[{id:'company',companyName:'QA',ownerId:'owner',password:'never-cache'}],members:[{id:'m',companyId:'company',userId:'owner',roles:['admin'],token:'secret'}],users:[{id:'owner',name:'QA',accessToken:'secret'},{id:'unrelated',name:'hidden'}],totalCount:1});assert.equal(readSeniorPanelCache('other'),null);const c=readSeniorPanelCache('viewer')!;assert.equal(c.users.length,1);assert.equal(c.companies[0].password,undefined);assert.equal(c.members[0].token,undefined);assert.equal(c.users[0].accessToken,undefined);});
await test('Catálogo inválido é rejeitado e catálogo vazio confirmado substitui anterior',async()=>{storage.setItem(SENIOR_CATALOG_CACHE_PREFIX+'corrupt',JSON.stringify({version:1,viewerId:'corrupt',savedAt:Date.now(),companies:[],members:[null],users:[],totalCount:1}));assert.equal(readSeniorPanelCache('corrupt'),null);writeSeniorPanelCache('viewer',{companies:[],members:[],users:[],totalCount:0});assert.deepEqual(readSeniorPanelCache('viewer')?.companies,[]);beginAuthTeardown();assert.equal(readSeniorPanelCache('viewer'),null);assert.equal([...storage.data.keys()].some(k=>k.startsWith(SENIOR_CATALOG_CACHE_PREFIX)),false);});
await fs.mkdir('reports',{recursive:true});await fs.writeFile('reports/senior-cache-496.json',JSON.stringify({pass:true,checks:results.length,results},null,2)+'\n');
console.log('SENIOR_CACHE_496_PASS',results.length,'checks');
