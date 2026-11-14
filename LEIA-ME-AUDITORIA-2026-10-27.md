# NVU — Web 2.3.198, fonte candidata de auditoria

Base nativa preservada: Android 1.0.520 / code 520. Nenhum APK foi produzido ou aprovado nesta auditoria. As notas antigas no projeto são históricas; o resultado desta execução está em `reports/audit-2026-10-27/` e em `qa/results/latest.html`.

## Preparar e validar

Node 22+, npm 10+, JDK 21 e Chromium/Playwright são necessários. Execute `npm ci`, `npm --prefix functions ci`, `npm run qa:setup`, `npm run qa`. O catálogo de QA mantém todas as verificações anteriores e acrescenta regressões de equipe, ranking e imagens.

`npm run test:audit-general` executa os testes de regressão locais. O modo `NVU_AUDIT_BASELINE=true` é interno à reprodução e só funciona no checkout de auditoria com o commit original; a execução normal independe de Git. O ZIP entregue inclui os resultados anteriores e posteriores.

## Netlify

O ZIP de publicação contém o conteúdo de `dist` diretamente na raiz: `index.html`, `assets`, `_redirects`, `_headers` e `nvu-build.json`. Faça o deploy desse conteúdo. O build não requer segredos administrativos. A configuração Web pública do Firebase da base foi mantida. Não coloque tokens, contas de serviço ou senhas em variáveis `VITE_*`: elas entram no JavaScript do navegador.

Não é necessário alterar regras globais nem desativar o secrets scanning para publicar o ZIP pronto. Quando houver build no Netlify, use `npm ci && npm run build` e diretório de publicação `dist`.

## Backend e dados existentes

A correção de recuperação de fotos a partir da ficha aprovada também altera `functions/src/userProfiles.ts` e `functions/src/driverDisplayIdentity.ts`. Publicar apenas a Web não executa essa parte. A Function existente `syncUserPublicProfile` precisa ser atualizada por um administrador autenticado e as projeções antigas precisam ser reavaliadas.

O utilitário existente `functions/scripts/backfill-public-users.cjs` faz dry-run por padrão. Depois de conferir o projeto e o relatório, um administrador pode executar a regeneração aditiva. Ela escreve apenas `public_users`, preserva os documentos originais e respeita remoção explícita de foto. Nenhum deploy ou backfill de produção foi executado nesta auditoria.

Rankings completos antigos podem ser lidos sem tentar uma reconstrução que o servidor proíbe após 70 dias. Períodos ausentes são apresentados como "Histórico não consolidado", não como zero viagens. A reconstrução de períodos antigos ausentes exige uma operação administrativa adicional, com acesso à fonte real e população comparativa completa. Não foram inventadas posições.

## Android

O Capacitor está configurado para assets locais e OTA desativada. Publicar a `dist` no Netlify atualiza a Web; os APKs já instalados não recebem essas correções automaticamente. Para distribuí-las no Android, será necessário compilar, assinar e testar outro APK com o build corrigido. Antes do release, seguir `qa:release` e `qa:gate`; Android instrumental indisponível bloqueia aprovação.

## Limite de homologação

Testes com dados fictícios não confirmam o estado do Firebase de produção, URLs reais das fotos dos prints, Google OAuth, FCM em aparelho, GTO ou permissões da Motorola. O relatório final distingue essas pendências dos defeitos de código corrigidos.
