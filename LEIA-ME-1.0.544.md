# NVU PRO 1.0.544 (Android) / Web 2.3.201 / Windows 0.2.2

Base atual do projeto (branch `dist-build`). **Uma única base** reúne:
- **Web** (`src/`), versão 2.3.201 — é a interface de tudo.
- **Android** (`android/`), versão 1.0.544 (`versionCode` 544). O APK embute o web desta base. Como o `versionCode` é maior que o da 543, instala como **atualização**, sem limpar dados.
- **Windows** (`desktop/windows/`), versão 0.2.2: carrega o **mesmo web**, empacotado dentro do instalador (`resources/web`). O plugin do jogo continua na 0.2.0 (não mudou).
- **Functions e regras** (`functions/`, `firestore.rules`, `storage.rules`): publicadas só com autorização explícita; esta versão não publica nada em produção.

## O que mudou desde a 543

- **Página Guias** (antes "Manual"): ficou só com o Guia do Motorista e o Guia do Empresário, um por vez, escolhidos por um seletor logo abaixo da legenda do título. Cada guia tem o ícone ao lado do título (perfil no Motorista, prédio no Empresário), a linha "Guia completo em PDF — Baixar" e as três etapas em cartões que abrem e fecham. Saíram "Como usar os guias", "Regras da plataforma" e "Padrão do comprovante".
- O envio/exclusão de guias pelo Painel Sênior (regras já publicadas) continua igual e vale para esta página.

O APK gerado pelo fluxo `APK Debug` é de **depuração**; o APK assinado de distribuição é gerado à parte, com a chave do projeto.
