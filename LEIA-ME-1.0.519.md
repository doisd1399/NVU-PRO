# NVU PRO 1.0.519 — envio e identidade

Código preparado a partir da versão 1.0.518 fornecida. Esta entrega contém o código-fonte, as Functions compiladas, o site compilado em `dist` e os assets Web sincronizados no Android. Nenhum APK assinado faz parte da entrega.
Atualização Web 2.3.196: as seis Functions alteradas foram publicadas no projeto `vtc-frota-log` em 25/10/2026. Nenhum APK foi gerado, conforme solicitado. O ZIP separado da `dist` contém os arquivos públicos diretamente na raiz para a publicação no Netlify.

## Alterações

- O upload do print começa em segundo plano depois da leitura e da gravação segura da imagem, enquanto o motorista completa a rota. O lançamento reutiliza o mesmo envio, sem duplicar upload; falhas mantêm o comprovante local para nova tentativa.
- O upload normal usa a autorização das regras de Storage diretamente. A chamada de reparo de vínculo é executada apenas se o Storage recusar por autorização, uma vez. As regras, a verificação de proprietário e a validação do servidor permanecem ativas.
- `registerCanonicalSimpleTrip` devolve a cópia da viagem gravada na transação, com timestamps do servidor. O aplicativo valida identidade, motorista, empresa, operação, contrato, rota, valor e hash antes de confirmar. Essa resposta elimina uma leitura de rede adicional. Servidores anteriores continuam compatíveis pela leitura de confirmação existente.
- A remoção consulta as inscrições e solicitações do motorista afetado, incluindo os aliases legados por e-mail/driverId. Não percorre todas as inscrições da empresa. Autorização e leitura do motorista são paralelas, com a leitura da empresa compartilhada; a revogação continua atômica e preserva outras empresas.
- A página Equipes prepara a conexão do serviço ao abrir; o modal de remoção fecha imediatamente após a confirmação do usuário e o card indica a ação pendente. O motorista só desaparece depois da confirmação do servidor. O resultado confirmado atualiza os dados locais sem aguardar outro snapshot.
- A identidade visual usa o cadastro aprovado e as edições posteriores de perfil da NVU. Nome e foto do provedor de login deixam de ser usados como substitutos da identidade da plataforma. A remoção intencional da foto permanece sem foto. Equipes, perfis, seleção de motoristas, ranking e moderação usam a mesma resolução. Formulários legados são lidos por ID e escopo quando necessário. O perfil público autenticado acompanha a identidade atual sem reescrever nomes históricos de viagens.
- As marcas de exclusão de viagens e a proteção contra reutilização de comprovantes continuam ativas.
- O painel de diagnóstico do lançamento só aparece após uma falha da tentativa atual. Relatórios históricos salvos no Android não abrem o painel automaticamente. Uma nova seleção de imagem, uma nova tentativa, o sucesso ou a mudança de conta/empresa/operação ocultam o painel. A cópia nativa do último erro permanece preservada para suporte; cópia e compartilhamento continuam disponíveis quando há uma falha atual.

## Validação

Resultados desta entrega estão em `reports/release-519/`. Os testes usam o código real com transportes injetados, fixtures transacionais ou Chromium local. Os tempos registrados nesses testes não são medições do Motorola ou do Firebase em produção.

O teste existente `test-print-identity-518.mjs` é histórico e contém verificações fixas da versão 518; ele não deve ser usado como validador de versão da 519.

## Estado da publicação

As Functions `registerCanonicalSimpleTrip`, `manageFleetMembership`, `approveDriverRequest`, `approveRecruitmentApplication`, `repairApprovedMembership` e `removeDriverFromFleetSenior` foram publicadas. O resultado e a verificação de autenticação estão em `reports/release-519/`. As regras de Firestore e Storage não foram alteradas.

Para futuras compilações ou republicações pela conta autorizada do projeto:

```bash
npm ci
npm --prefix functions ci
npm run lint
npm --prefix functions run build
npx -y firebase-tools@latest deploy --only functions:registerCanonicalSimpleTrip,functions:manageFleetMembership,functions:approveDriverRequest,functions:approveRecruitmentApplication,functions:repairApprovedMembership,functions:removeDriverFromFleetSenior --project vtc-frota-log
npm run build
npx cap sync android
npm run prepare:cap-assets
npm run verify:cap-assets
npm run verify:cap-local
```

O APK 518 usa Web local e OTA desabilitada. Publicar apenas o `dist` no Netlify não atualiza esse APK. É necessário gerar e instalar o APK 519 com o `google-services.json` original e a mesma chave de assinatura, mantendo `com.nvu.operacional`. Use o fluxo Gradle de release do projeto com JDK 21 e Android SDK 36. As credenciais privadas não fazem parte desta entrega.

Instale como atualização sobre o aplicativo existente. Não desinstale nem limpe os dados para testar. A homologação final deve verificar um print novo, envio com e sem rede, aprovação, remoção, dois vínculos em empresas diferentes e edição posterior de nome/foto.
