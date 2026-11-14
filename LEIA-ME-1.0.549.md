# NVU PRO 1.0.549 (Android) / Web 2.3.206 / Windows 0.2.2

Base atual do projeto (branch `dist-build`). **Uma única base** reúne:
- **Web** (`src/`), versão 2.3.206 — é a interface de tudo.
- **Android** (`android/`), versão 1.0.549 (`versionCode` 549). O APK embute o web desta base. Como o `versionCode` é maior que o da 548, instala como **atualização**, sem limpar dados.
- **Windows** (`desktop/windows/`), versão 0.2.2: carrega o **mesmo web**, empacotado dentro do instalador (`resources/web`). O plugin do jogo continua na 0.2.0 (não mudou).
- **Functions e regras** (`functions/`, `firestore.rules`, `storage.rules`): publicadas só com autorização explícita; **esta versão não publica nada em produção**.

## O que mudou desde a 548 — ações lentas (3 a 8 s)

### Causa principal: as ações rodavam no continente errado
O banco (Firestore) fica em **São Paulo** (`southamerica-east1`), mas todas as funções de ação rodavam em **Iowa** (`us-central1`). Iniciar, finalizar, cancelar, designar, remover da frota, promover e salvar viagem fazem de 8 a 10 leituras seguidas no banco; cada uma atravessava o continente (~130–200 ms), e o celular ainda pagava a conexão e a verificação (preflight) até Iowa. A soma explica os 3–8 s.

### O que foi feito
- **Funções de ação também em São Paulo** (servidor): 29 funções interativas (`operationalCommand`, `registerCanonicalSimpleTrip`, `completeCanonicalOperation`, `reconcileOperationTrips`, `manageFleetMembership`, ações do Sênior, aprovações etc.) passam a ser declaradas em **`southamerica-east1` e `us-central1`**. A cópia de Iowa **continua**, para os aplicativos já instalados. É o mesmo código e o mesmo banco; nada é "dividido". Gatilhos do Firestore **não** foram duplicados (processariam cada evento duas vezes).
- **App chama São Paulo primeiro** (`src/lib/regionalCallable.ts`), com retorno seguro para Iowa **somente** quando a cópia de São Paulo claramente não existe (HTTP 404 do Google, ou falha de rede antes de São Paulo ter respondido alguma vez). Erro de verdade do servidor (sem permissão, regra de negócio, 500) **nunca** é repetido em outra região. Emulador e funções fora da lista não mudam.
- **Aquecimento barato** (`src/lib/warmCallables.ts`): ao abrir o app, ao voltar para ele ou ao reconectar, 5 funções recebem um ping `{ __warm: true }` (no máximo 1 vez a cada 10 min, só com o app visível, online e logado, sem temporizador). O servidor responde antes de qualquer autorização ou leitura de banco — **0 leituras**.
- **Início/finalização não esperam mais outra sincronização**: um comando salvo (iniciar/finalizar) agora é enviado na hora, numa faixa própria, em vez de aguardar o ciclo geral (que também confere o estado nativo e reenvia viagens, podendo levar segundos).
- **Fila local não cresce sem fim**: comandos confirmados há mais de 7 dias (ou além dos 30 mais recentes) saem da fila local. Antes, cada toque lia e reescrevia o histórico inteiro, ficando mais lento com o uso (e podendo estourar o armazenamento do aparelho). Nada pendente, rejeitado ou com limpeza nativa por fazer é descartado. A primeira sincronização após abrir o app também deixa de fazer duas chamadas nativas para cada comando antigo.
- **Aviso honesto**: o "Início salvo neste aparelho… você pode trabalhar offline" só aparece sem internet; com internet mostra "Confirmando o início no servidor…".

### O que NÃO foi feito (e por quê)
- Nenhuma função foi publicada. **Enquanto as funções não forem publicadas em São Paulo, o app novo cai no fallback para Iowa** (1 tentativa extra e curta por função, depois lembra por 10 min) e a velocidade fica como antes.
- Os 26 gatilhos do Firestore continuam em Iowa (rodam em segundo plano, fora do caminho do toque).
- Memória das funções (256 MB) e "instâncias mínimas" **não** foram alterados, para não aumentar custo.

### Verificação
Testes novos: `callable-regions` (lista do app = lista do servidor; gatilhos nunca duplicados; roteamento e fallback contra o SDK real do Firebase com `fetch` simulado, incluindo erro de negócio "não encontrado" que **não** pode ir para outra região; custo do aquecimento) e `durable-outbox` (agora no QA; histórico limitado). Os tempos reais (antes/depois) **só podem ser medidos depois da publicação**, num aparelho no Brasil.

O APK gerado pelo fluxo `APK Debug` é de **depuração**; o APK assinado de distribuição é gerado à parte, com a chave do projeto.
