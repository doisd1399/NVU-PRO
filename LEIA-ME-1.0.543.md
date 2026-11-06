# NVU PRO 1.0.543 (Android) / Web 2.3.200 / Windows 0.2.1

Base atual do projeto (branch `dist-build`). **Uma única base** reúne:
- **Web** (`src/`), versão 2.3.200 — é a interface de tudo.
- **Android** (`android/`), versão 1.0.543 (`versionCode` 543). O APK embute o web desta base. Como o `versionCode` é maior que o da 542, instala como **atualização**, sem limpar dados.
- **Windows** (`desktop/windows/`), versão 0.2.1: carrega o **mesmo web**, empacotado dentro do instalador (`resources/web`). O plugin do jogo continua na 0.2.0 (não mudou).
- **Functions e regras** (`functions/`, `firestore.rules`, `storage.rules`): publicadas só com autorização explícita; esta versão não publica nada em produção.

## O que mudou desde a 542

1. **Ranking interno** (`Ranking › Interno`): passa a ler o resumo do servidor (o mesmo do Global) filtrado pela empresa escolhida. Antes dependia de ler as viagens da empresa direto no aparelho — leitura que as regras limitam a gestores/membros — e mostrava "Não foi possível carregar o ranking." para alguns usuários, além de poder divergir do Global. A leitura direta das viagens só entra se o resumo do servidor não existir para o período ou não responder.
2. **Manual**: o manual genérico foi substituído pelo **Guia do Motorista** e pelo **Guia do Empresário** (resumo das 3 etapas de cada um, botão **Baixar guia**, instruções de uso na própria página). Os PDFs acompanham o app (`public/guias/`) e funcionam sem internet.
3. **Guias sem trocar o APK** (Painel Sênior › Opções › **Gerenciar guias**): o Sênior envia um PDF novo ou exclui o enviado; a página Manual de todos passa a usar o arquivo novo na hora. Sem arquivo enviado, o app mostra o guia que acompanha a versão instalada. **Depende de publicar `firestore.rules` e `storage.rules`** (coleção `app_guides` e pasta `app-guides/`); até lá o Manual mostra o guia do app e o envio é recusado.
4. **Painel Sênior**: **Opções** e **Ações do funcionário** deixam de ser janelas centralizadas e passam a painel inferior (mesmo padrão de "Informações da operação"). Ações do funcionário foi reorganizada em Frota / Conta / Zona de risco, com status no topo e confirmação em duas etapas (mesmas regras e mesmos comandos de antes).

O APK gerado pelo fluxo `APK Debug` é de **depuração**; o APK assinado de distribuição é gerado à parte, com a chave do projeto.
