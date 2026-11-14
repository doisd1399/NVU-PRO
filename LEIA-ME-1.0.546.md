# NVU PRO 1.0.546 (Android) / Web 2.3.203 / Windows 0.2.2

Base atual do projeto (branch `dist-build`). **Uma única base** reúne:
- **Web** (`src/`), versão 2.3.203 — é a interface de tudo.
- **Android** (`android/`), versão 1.0.546 (`versionCode` 546). O APK embute o web desta base. Como o `versionCode` é maior que o da 545, instala como **atualização**, sem limpar dados.
- **Windows** (`desktop/windows/`), versão 0.2.2: carrega o **mesmo web**, empacotado dentro do instalador (`resources/web`). O plugin do jogo continua na 0.2.0 (não mudou).
- **Functions e regras** (`functions/`, `firestore.rules`, `storage.rules`): publicadas só com autorização explícita; esta versão não publica nada em produção.

## O que mudou desde a 545

- **TOE 3 (modo Pro) — "Não foi possível confirmar o valor do recebimento" (continuava na 545)**:
  - Quando uma leitura não confirmava o valor, a captura ficava **esperando um quadro novo** da projeção de tela — que numa tela de resultado estática nunca chega — até o limite de 30 s. Agora ela **volta a ler o último quadro, pede quadro novo à projeção** (religando a saída do display) e tenta de novo.
  - O valor passa a ser lido também num **recorte só da célula branca do "Renda total"** (calibrado nas capturas reais, com a proporção 20:9 do jogo), além da linha rótulo+valor, do modal e da tela inteira. O ganho só é aceito quando **duas fontes independentes** concordam (a linha e a célula são os mesmos pixels e contam como uma só; as outras são o modal, a tela inteira e o quadro anterior).
  - A tela de resultado do TOE 3 passa a ser reconhecida também por outras palavras da grade/botões (antes dependia do rótulo "Renda total" ser lido); a moeda vem do símbolo da célula.
  - Se ainda falhar, a mensagem mostra o que foi lido (ex.: "leitura 3, quadros 5, linha —, célula 3,934, modal —, tela —") para fechar o diagnóstico.
- Windows continua na 0.2.2 (sem mudança nesta versão).

O APK gerado pelo fluxo `APK Debug` é de **depuração**; o APK assinado de distribuição é gerado à parte, com a chave do projeto.
