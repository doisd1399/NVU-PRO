# NVU — correções reconstruídas após a interrupção

Base recuperada e conferida a partir do commit remoto `a5f6550741cda403a62c0a544f7e50480dad733d`, branch privada `qa/automated-tests-520`. A revisão anterior perdida que mencionava 15 grupos não foi usada como comprovante. Esta fonte tem nova execução e novas evidências em `verification/audit-2026-10-26/recovery/final-qa.json` e nos artefatos do workflow.

## O que mudou na fonte

- SEC-01: catálogo de simuladores exige claim Sênior verificável e valida a estrutura tanto no create quanto no update.
- SEC-02: associações de push são escritas/revogadas somente pelos callables canônicos; cliente não pode tomar o documento de outra conta.
- SEC-03: `users` fica legível somente pelo próprio usuário. Ranking, identidade visível e diretório usam `public_users`, uma projeção de campos permitidos, atualizada no servidor. Contatos de gestão são consultados por endpoint limitado e autorizado por empresa; o painel Sênior também usa o endpoint autorizado. Primeiro login verificado pode recuperar sua identidade por e-mail. O cache operacional tem namespace novo e não restaura as antigas cópias completas de usuários.
- SEC-04: um cadastro pendente não pode criar/ativar a própria frota nem marcar sua inscrição aprovada. O fluxo Sênior continua podendo aprovar e cadastrar a empresa.
- PUSH-01/02/03/04: lotes anteriores de recuperação foram preservados, incluindo registro recuperável, revogação ordenada, lease, retries transitórios e proteção na troca de conta.
- NOT-02/03 e PUSH-06: regras aceitam as marcações legítimas de popup, a consulta moderna limita por recência, e uma única navegação seleciona o perfil/empresa autorizado antes de abrir o aviso. Há índices e utilitários de migração explícitos.
- DEP-01: auditorias de dependências de produção retornaram zero avisos na raiz e nas Functions. Admin SDK 14.5.0 usa APIs modulares por uma ponte local; Functions 7.4.0 mantém imports V1. O helper antigo de testes incompatível foi substituído pelo método `run` dos handlers reais. React/React DOM foram mantidos em 19.2.8 para preservar o comportamento já testado.
- QA-01/02/03: teste de armazenamento controla a presença do Web Lock experimental do Node, os testes de concorrência verificam ACKs e isolamento por operação sem assumir serialização global, e o fingerprint cobre também entradas de build, configuração e migrações.

## Evidências e limites

A pré-verificação passou em 12 cenários de regras/privacidade, 10 de notificações, 16 de fluidez, além dos cenários de push cliente/servidor preservados. A execução consolidada da fonte final é a evidência autoritativa; consulte `final-qa.json` para etapas, fingerprint, horários e resultado. O app completo usa Auth/Firestore/Storage locais; o cenário de navegação abre avisos reais no App/providers, sem declarar que enviou FCM de verdade.

Os achados originais estão resolvidos **na fonte**. `ROLL-01` permanece P1 aberto e bloqueia a liberação: exige backend, migrações, índices, atualização dos clientes e regras na ordem de [ROLLOUT.md](ROLLOUT.md). APKs antigos fazem leituras agora restritas; publicar regras primeiro quebraria esses clientes. Esta revisão não publicou Firebase, não mudou dados de produção e não gerou APK de release. Google OAuth, entrega FCM física, comportamento Motorola/GTO e latência real continuam fora do alcance desta bateria.

As regras são um protótipo validado pelos cenários documentados; não certificam ausência de outras falhas. O registro histórico abaixo é preservado para rastrear a origem dos achados. Metadados e contagens antigas são históricos, não uma nova leitura da produção nesta retomada.

---

# NVU — auditoria de estabilidade, notificações e produção

Data: 26/10/2026. Base: Android 1.0.520 / Web 2.3.197, commit remoto `870c23d9d4cab534fc8073aea1bb24465b23b8ff`, branch privada `qa/automated-tests-520`.

## Situação da revisão

A autenticação no Firebase foi concluída e a conferência de produção foi somente de leitura. Nenhuma regra, Function, índice ou documento de produção foi alterado; nenhum push real foi enviado. A publicação desta revisão de fonte e testes na branch foi autorizada explicitamente pelo proprietário em 26/10/2026. Isso não é publicação de APK ou backend.

A sessão temporária perdeu o checkout local anterior. A base foi reconstruída a partir da árvore Git remota: 1.632 blobs conferidos pelo SHA-1 de blob e árvore final `6f29d0f695b080bb27696bdd27fafe74ba86ff1e`, idêntica à base publicada. A correção, os testes e o bloqueio de release foram reconstruídos e novamente exercitados. Esta revisão não se apresenta como o mesmo commit local perdido.

O [relatório original preservado](REPORT-original.html) contém os achados e os limites da primeira auditoria. As suas referências a resultados brutos antigos não representam arquivos recuperados: os JSON/probes e os logs daquela sessão não foram recuperados nem inventados. As 42 verificações suplementares (40 aprovações e duas falhas antigas) são um registro histórico, não uma nova execução. Os resultados atuais ficam em `verification/audit-2026-10-26` após a validação completa.

## Correção de notificações e evidência atual

**NOT-01, resolvido na fonte:** com as flags legadas padrão, o histórico só é buscado após demanda. O realtime exigia que a capacidade de histórico estivesse desligada para marcar a fonte como inicializada. Assim, `notificationsHydrated` permanecia falso sem abrir o sino, e o efeito de popup ignorava os novos avisos.

Os dois callbacks agora verificam `legacyHistoryEnabled`, a busca efetivamente solicitada na sessão. Não foram alterados SDKs, regras de acesso ou backend. O teste reconstruído `qa/tests/notifications.mjs` falhou na base anterior (`false !== true` na hidratação) e passou após a mudança, com seis cenários:

1. Hidratação sem abrir o sino e sem buscar o histórico legado, preservando as flags padrão.
2. Novo aviso dispara o efeito real de toast após a hidratação inicial.
3. Snapshot repetido não exibe outro popup.
4. Avisos de outra empresa ficam ocultos em ambas as coleções.
5. Callback tardio da conta anterior não publica na conta nova; a conta nova continua recebendo avisos.
6. Aviso já existente no snapshot inicial preenche o sino sem popup; um aviso posterior aparece.

O Provider, o listener e as regras de escopo são reais, executados com React DOM/JSDOM. Auth, Firestore, rota e transporte de toast são controlados. Isso comprova esta regressão da interface; não comprova entrega FCM no aparelho, permissões Motorola ou comportamento com o app fechado.

O mecanismo de qualidade tem nove autotestes. A política `qa/audit-blockers.json` mantém nove achados P1 abertos e seis P2, além de NOT-01 resolvido com evidências. Um P0/P1 aberto impede aprovação de release mesmo com testes funcionais verdes. Política configurada ausente/corrompida ou resolução sem evidência também bloqueia. Web/quick continuam executando para apoiar as correções.

## Conferência da produção

Os resultados sanitizados estão em [production-metadata.json](production-metadata.json). Logs brutos, tokens, IDs de contas e payloads privados não fazem parte desta revisão.

| Item | Resultado observado |
|---|---|
| Projeto/banco | `vtc-frota-log`, `(default)`, Firestore Standard, modo nativo, `southamerica-east1` |
| Regras do Firestore | Hash SHA-256 `392fdcc401434f99e93a8a5c3067e8380729513a3c40f04e7e920b8afcd579ce`, idêntico à base auditada |
| Regras do Storage | Hash SHA-256 `f753a60e28909ff2143481ac4dc5a16ebd280a1401bce7ddb473f23ceed39d49`, idêntico à base auditada |
| Índices compostos | 23 locais e 23 publicados; nenhuma diferença semântica após remover o desempate `__name__` e metadados implícitos do servidor |
| Functions | 69 funções listadas; as selecionadas de viagens, frota e push estão `ACTIVE`, em `us-central1`, runtime Node 22 |
| Push moderno/legado | Ambos os gatilhos existem nas coleções esperadas e estão com `retry: false` |

A equivalência das regras confirma que as políticas locais auditadas são as publicadas. Não demonstra exploração por terceiros. Não foram usadas contas nem documentos reais como fixtures. A edição do banco foi identificada antes de avaliar mudanças; nenhuma mudança de modelo ou regras foi aplicada.

A listagem comprova metadados das Functions, não a identidade byte a byte do código-fonte que está implantado. A ausência de erro no recorte de logs também não prova sucesso de entrega ao dispositivo.

## Demora observada nos logs

Foram consultadas duas amostras limitadas de até 200 entradas, preservadas apenas como agregados. A amostra operacional abrange de 25/10/2026 17:05 até 26/10/2026 16:44, horário de São Paulo; a de push abrange 26/10/2026 09:16–17:14. Respostas HTTP 204 de preflight foram separadas das respostas 200 na tabela abaixo.

| Função e conclusão | Registros de conclusão | Mediana no servidor | Maior tempo |
|---|---:|---:|---:|
| `registerCanonicalSimpleTrip`, HTTP 200 | 16 | 3.577,5 ms | 6.281 ms |
| `manageFleetMembership`, HTTP 200 | 18 | 1.390,5 ms | 6.775 ms |
| `registerPushDevice`, HTTP 200 | 38 | 1.281 ms | 7.449 ms |
| `pushOnNotificationCreated`, status `ok` | 9 | 3.194 ms | 5.777 ms |

Esses são registros de execução de função, não contagens de usuários nem confirmação do resultado de negócio ou da entrega FCM. O tempo de envio completo ainda inclui preparação local, fila, upload, rede e atualização da interface. Há demora medida no backend; não foi demonstrada uma causa única para toda a espera.

O banco está em São Paulo e as Functions selecionadas nos EUA. A distância entre regiões é uma hipótese de contribuição a investigar, não uma conclusão causal extraída destes logs. A próxima medição deve separar autenticação, leituras, Storage/validação do comprovante, transação e projeções. Não remover guardas de identidade, tombstones, autorização ou comprovante para encurtar tempos; não mover funções ou manter instâncias pagas automaticamente sem avaliar compatibilidade e custo.

## Prioridades que permanecem abertas

| Prioridade | IDs | Trabalho necessário |
|---|---|---|
| P1: escritas e aprovação | SEC-01, SEC-02, SEC-04 | Restringir catálogo global, preservar proprietário de dispositivos e impedir autoativação de cadastro pendente. Validar caminhos autorizados e recusados. |
| P1: privacidade de perfis | SEC-03 | Criar projeção pública mínima e migrar ranking/equipes/perfis antes de restringir o documento completo de `users`. |
| P1: registro/entrega push | PUSH-01/02/03/04 | Permitir retry de registro após falha, classificar erros FCM individuais, expirar leases interrompidos e revogar com segurança a associação antiga ao sair. `retry: false` publicado reforça a necessidade de corrigir também a política de reenvio. |
| P1: dependências | DEP-01 | Analisar alcance e atualizar patches compatíveis; repetir regressões. Evitar `npm audit fix --force`, que propõe mudanças incompatíveis e downgrades. |
| P2: notificações | NOT-02/03, PUSH-06 | Alinhar campos de popup com regras, ordenar o limite por recência e corrigir o evento de abertura do push. |
| P2: qualidade | QA-01/02/03 | Reparar testes legados de storage/estado transitório e ampliar o fingerprint para todos os insumos estáveis. |

O relatório original detalha a evidência histórica de cada ID. Nenhum desses achados foi marcado como resolvido apenas por obter login ou publicar esta revisão.

## Consultas e dependências

O inventário [query-inventory.json](query-inventory.json) foi regenerado do AST TypeScript nesta base: 452 arquivos Web, 75 construções diretas de query e 36 chamadas diretas a `onSnapshot`. Há também 78 chamadas diretas de leitura identificadas nas APIs inventariadas (`getDoc`, `getDocs` e variantes de servidor). Esses números são pontos de chamada na fonte; wrappers, tráfego, frequência e latência reais não são resolvidos pelo inventário.

`npm audit --omit=dev` foi repetido nos dois lockfiles. [Raiz](npm-audit-runtime.json): nove pacotes afetados, um crítico e oito altos. [Functions](npm-audit-functions.json): 16 pacotes afetados, um crítico, cinco altos e dez moderados. Os totais propagam avisos a pacotes pais e não equivalem a falhas independentes ou exploração comprovada. A raiz inclui ferramentas/peers; o alcance no bundle e no backend exige revisão. Nenhuma dependência foi alterada.

O ranking comum usa deltas; mudanças de catálogo/identidade podem reconstruir períodos. O catálogo de empresas é lido sob demanda e reutilizado; não há evidência para atribuir uma leitura completa a cada render ou a cada viagem. A auditoria administrativa de dados canônicos é separada do registro comum de viagem. Prefira medições e paginação planejada a limites arbitrários que ocultem registros.

## Validação e limites

Use `npm run qa` para os 13 grupos Web/Firebase e `npm run qa:gate` para comprovar o bloqueio por achados abertos. O relatório da nova execução, seu fingerprint e os seis cenários ficam em `verification/audit-2026-10-26`. A execução Android histórica 40362984668 não é evidência desta revisão reconstruída; Android/FCM físico não foram declarados aprovados aqui.

Próximos passos: corrigir os P1 em mudanças pequenas com testes de comportamento seguro; validar o fluxo legítimo ao fechar regras; migrar a projeção pública antes de restringir os leitores; só liberar outra versão depois de resolver os bloqueios e executar a bateria Android da fonte final. Esta auditoria organiza riscos e evidências; não certifica ausência de outros defeitos.
