# NVU PRO 1.0.548 (Android) / Web 2.3.205 / Windows 0.2.2

Base atual do projeto (branch `dist-build`). **Uma única base** reúne:
- **Web** (`src/`), versão 2.3.205 — é a interface de tudo.
- **Android** (`android/`), versão 1.0.548 (`versionCode` 548). O APK embute o web desta base. Como o `versionCode` é maior que o da 547, instala como **atualização**, sem limpar dados.
- **Windows** (`desktop/windows/`), versão 0.2.2: carrega o **mesmo web**, empacotado dentro do instalador (`resources/web`). O plugin do jogo continua na 0.2.0 (não mudou).
- **Functions e regras** (`functions/`, `firestore.rules`, `storage.rules`): publicadas só com autorização explícita; esta versão não publica nada em produção.

## O que mudou desde a 547

- **Trabalho de motorista que já saiu da empresa aparecia na empresa (caso Dudu TV na DC Transportes)**: "Remover da frota" (pela empresa ou pelo Painel Sênior) encerrava o vínculo, mas **não cancelava os trabalhos abertos** do motorista nela. Eles ficavam abertos para sempre: contados pela empresa, com o veículo "em uso" e sem ninguém para finalizá-los. Só a saída voluntária do motorista cancelava os trabalhos.
  - **Servidor** (`removeFleetMemberCore`, usada por `manageFleetMembership` e `removeDriverFromFleetSenior`): ao remover, cancela na mesma transação os trabalhos pendentes/em andamento/atrasados/aguardando finalização do motorista **naquela empresa**, libera veículo e reboque que nenhum outro trabalho em execução usa, zera o estado do motorista e registra os trabalhos cancelados na auditoria. As viagens registradas e a outra empresa do motorista não são tocadas. Repetir a remoção também termina a limpeza de um trabalho deixado aberto antes. **Exige publicar as duas Functions** (`manageFleetMembership` e `removeDriverFromFleetSenior`); nada foi publicado.
  - **Aplicativo**: a lista de operações da empresa e a seção do Painel Sênior marcam o trabalho de quem não é mais membro com **"Fora da empresa"** (e um aviso na ficha da operação), para cancelar os que já existem. Sem a lista de membros carregada, ninguém é marcado.
- Windows continua na 0.2.2 (sem mudança nesta versão).

O APK gerado pelo fluxo `APK Debug` é de **depuração**; o APK assinado de distribuição é gerado à parte, com a chave do projeto.
