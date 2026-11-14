# NVU Windows — continuação de ativação

As três funções Windows foram publicadas no projeto `vtc-frota-log`, em `us-central1`, usando Firebase CLI 15.34.2: `registerCanonicalSimpleTrip`, `updateWorkModeAvailability` e `operationalCommand`. O servidor reportou ACTIVE para todas; os hashes mudaram apenas nessas funções. Não houve criação ou remoção de funções. O log e os metadados sanitizados estão neste diretório.

As três chamadas sem autenticação retornaram HTTP 401 / UNAUTHENTICATED. A expectativa inicial de 403 para o controle Senior estava errada: a fonte exige login antes de verificar a função Senior. A primeira evidência foi preservada, e a verificação repetida com o contrato correto passou. A autorização de usuários autenticados e a consistência de dados foram exercitadas somente no projeto fictício dos emuladores. Nenhuma viagem de produção foi criada para teste.

A correção em `workModeAvailability.ts` mantém os controles ETS2/ATS no mesmo catálogo da política do servidor e conserva o estado anterior quando um cliente antigo omite campos. Testes cobrem autorização, conflito de versão, auditoria e preservação de configurações.

O QA completo foi repetido após atualizar o guia: 18/18 etapas aprovadas, fonte inalterada durante a execução. Consulte `qa-current/report.json` e os logs. O instalador permanece byte a byte igual ao entregue: somente o backend e a documentação mudaram nesta continuação.

Ainda faltam: cliente OAuth Google do tipo Aplicativo para computador no projeto da NVU, integração desse cliente e validação de identidade Firebase, testes no Windows com ETS2 e ATS reais e assinatura digital para distribuição pública. A página do Console Google retornou Site Unavailable neste ambiente. A autenticação do Firebase CLI foi concluída, mas não cria nem configura o cliente OAuth do aplicativo Windows.

Para obter a configuração OAuth: abrir Google Auth Platform → Clientes → Criar cliente → Aplicativo para computador; usar o projeto `vtc-frota-log`, nome NVU PRO Windows, baixar o JSON desse cliente. Referência oficial: https://developers.google.com/identity/protocols/oauth2/native-app

A publicação está comprovada por metadados e pelo teste de rejeição sem login. O fluxo autenticado completo com uma viagem real continua pendente. A candidata não foi declarada pronta para produção.
