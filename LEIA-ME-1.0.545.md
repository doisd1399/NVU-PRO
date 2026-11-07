# NVU PRO 1.0.545 (Android) / Web 2.3.202 / Windows 0.2.2

Base atual do projeto (branch `dist-build`). **Uma única base** reúne:
- **Web** (`src/`), versão 2.3.202 — é a interface de tudo.
- **Android** (`android/`), versão 1.0.545 (`versionCode` 545). O APK embute o web desta base. Como o `versionCode` é maior que o da 544, instala como **atualização**, sem limpar dados.
- **Windows** (`desktop/windows/`), versão 0.2.2: carrega o **mesmo web**, empacotado dentro do instalador (`resources/web`). O plugin do jogo continua na 0.2.0 (não mudou).
- **Functions e regras** (`functions/`, `firestore.rules`, `storage.rules`): publicadas só com autorização explícita; esta versão não publica nada em produção.

## O que mudou desde a 544

- **TOE 3 (modo Pro) — "Não foi possível confirmar o valor do recebimento"**: o ganho agora é lido da linha **Renda total**, seja qual for a ordem em que o OCR devolve a tela. Antes, se o OCR agrupasse por coluna, a **Pena de dano (€ 202)** podia ser lida como o ganho, e o "20%" do botão de bônus podia virar 20,00; os dois recortes dedicados ao valor também terminavam acima da linha "Renda total". Ver `GtoResultOcrConsensusPolicy` e os testes `toe3*` em `GtoResultOcrConsensusPolicyTest`.
- O bloqueio de "bônus de vídeo consumido" passa a reconhecer valores em € e US$ (antes só R$).
- Windows continua na 0.2.2 (sem mudança nesta versão).

O APK gerado pelo fluxo `APK Debug` é de **depuração**; o APK assinado de distribuição é gerado à parte, com a chave do projeto.
