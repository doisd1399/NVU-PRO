# NVU PRO 1.0.547 (Android) / Web 2.3.204 / Windows 0.2.2

Base atual do projeto (branch `dist-build`). **Uma única base** reúne:
- **Web** (`src/`), versão 2.3.204 — é a interface de tudo.
- **Android** (`android/`), versão 1.0.547 (`versionCode` 547). O APK embute o web desta base. Como o `versionCode` é maior que o da 546, instala como **atualização**, sem limpar dados.
- **Windows** (`desktop/windows/`), versão 0.2.2: carrega o **mesmo web**, empacotado dentro do instalador (`resources/web`). O plugin do jogo continua na 0.2.0 (não mudou).
- **Functions e regras** (`functions/`, `firestore.rules`, `storage.rules`): publicadas só com autorização explícita; esta versão não publica nada em produção.

## O que mudou desde a 546

- **"Finalize sua operação atual antes de iniciar outra" sem operação visível (caso Dudu TV)**: a tela escondia trabalhos antigos "em andamento" (os legados mais antigos que o último concluído), mas o início contava **todos** os trabalhos em execução do motorista na empresa — o app e o servidor. Resultado: um trabalho que nenhuma tela listava bloqueava o início e ninguém conseguia cancelá-lo.
  - A lista de operações da empresa (e do Sênior dentro da empresa) passa a mostrar **todo** trabalho pendente ou em execução, não só o "atual" de cada motorista.
  - Antes de recusar o início, o app confere no servidor cada trabalho que bloqueia: se já foi cancelado/concluído/removido, a cópia velha do aparelho é corrigida e o início segue. Se ainda está em execução, a mensagem diz **qual** operação bloqueia e que a empresa pode cancelá-la.
- **Painel Sênior — suporte direto**:
  - Dentro da empresa (tela de operações), **Cancelar trabalho** e **Trocar veículo** estavam desabilitados para o Sênior ("Somente administradores da empresa"); agora funcionam.
  - No perfil da empresa no Painel Sênior há a seção **Trabalhos em aberto (suporte)**: lista todos os trabalhos pendentes ou em execução (inclusive os escondidos), com **Cancelar** e **Trocar veículo**, e mostra o motivo se o servidor recusar.
  - Sem mudança de regras nem de Functions: o servidor e as regras já aceitavam o Sênior.
- Windows continua na 0.2.2 (sem mudança nesta versão).

O APK gerado pelo fluxo `APK Debug` é de **depuração**; o APK assinado de distribuição é gerado à parte, com a chave do projeto.
