# NVU PRO 1.0.542 (Android) / Web 2.3.199 / Windows 0.2.x

Base atual do projeto (branch `dist-build`). **Uma única base** reúne:
- **Web** (`src/`), versão 2.3.199 — é a interface de tudo.
- **Android** (`android/`), versão 1.0.542 (`versionCode` 542). O APK embute o web desta base. Como o `versionCode` é maior que o da 541, instala como **atualização**, sem limpar dados.
- **Windows** (`desktop/windows/`): o aplicativo carrega o **mesmo web**, empacotado dentro do instalador (`resources/web`), não o site publicado. A versão do Windows tem numeração própria (publicado: 0.2.0, pré-lançamento da comunidade).
- **Functions e regras** (`functions/`, `firestore.rules`): publicadas só com autorização explícita; esta versão não publica nada em produção.

Mudanças desde a 541: Windows (aviso de nova versão, fotos e capa que sincronizam, sessão guardada para abrir offline, lista de jogos sem duplicata) e, no web compartilhado, meta financeira na moeda do simulador (US$ ATS, € ETS2, R$ comprovantes) e veículo da operação no histórico e na viagem do Windows.

O APK gerado pelo fluxo `APK Debug` é de **depuração**; o APK assinado de distribuição é gerado à parte, com a chave do projeto.
