# Distribuir a NVU Windows: sem custo, e com assinatura digital

Documento de quem publica a versão. Quem só instala usa o instalador e o `GUIA-ATUALIZAR-NVU-E-PREPARAR-ETS2-ATS.md`.

## 1. Onde estamos

- O instalador sai **sem assinatura**: `release-manifest.json` → `signing.status = unsigned`, `productionReady = false`. Sem certificado nem serviço de assinatura, nada é assinado e o fluxo de release assinado **para** com o bloqueio exato.
- Assinar troca "Editor desconhecido" pelo nome verificado do editor e deixa a origem comprovável. Mesmo assinado, o SmartScreen pode avisar no começo: a reputação se constrói com o tempo (a Microsoft informa que, desde 2024, nem o certificado EV pula essa etapa).
- Certificado autoassinado não vale confiança pública. O CI usa um descartável só para provar o encanamento.

## 2. Caminhos SEM custo (pesquisados em 02/11/2026; confira na Microsoft/SignPath antes de decidir)

| Caminho | Custo | O que o usuário vê | Exige | Situação |
|---|---|---|---|---|
| **A. Versão da comunidade sem assinatura** (GitHub Releases) | R$ 0 | Tela azul do SmartScreen: *Mais informações → Executar assim mesmo*. PCs de empresa podem bloquear de vez. | Nada além dos Secrets do OAuth | **Pronto agora** (seção 3) |
| **B. Microsoft Store com pacote MSIX** | R$ 0 (registro de pessoa física gratuito desde set/2025) | Nenhum aviso: a Microsoft assina o pacote na certificação | Empacotar em MSIX, passar na certificação e adaptar o fluxo de elevação do plugin (pacote da Store tem restrições) | Possível; é trabalho de engenharia (fase 2) |
| **C. SignPath Foundation** | R$ 0 | Assinado com certificado OV da SignPath Foundation | **Código aberto**: licença aprovada pela OSI em todos os componentes, sem partes proprietárias, projeto ativo e já lançado, MFA, papéis autor/revisor/aprovador, página "Code signing policy". Aceitação é discricionária. | Só se você decidir abrir o código |

Para o instalador `.exe`/`.msi` enviado à Store, a Microsoft **não** assina: ele precisa de assinatura própria. Só o MSIX é assinado de graça pela Microsoft.

Não servem: Azure Artifact Signing (pessoa física só nos EUA/Canadá; empresas nos EUA/Canadá/UE/Reino Unido), certificado autoassinado (bloqueia a instalação para o público) e "desativar o SmartScreen/antivírus" (nunca é solução).

## 3. Publicar a versão da comunidade (caminho A) — passo a passo

Uma vez só:
1. **Google Cloud** (projeto `vtc-frota-log`) → APIs e serviços → **Tela de consentimento OAuth**: confira o status de publicação. Para qualquer pessoa da comunidade entrar, ele precisa estar **Em produção** (em *Teste* só entram os até 100 e-mails cadastrados). O login do Windows pede só `openid email profile`; segundo a Google, apps de teste com só esses escopos nem expiram o token em 7 dias, e em produção com escopos básicos não exigem a tela de app não verificado. Confirme no console.
2. **GitHub** → Settings → Environments → **New environment** `windows-release` (pode marcar *Required reviewers* para pedir sua aprovação a cada execução) → **Add secret**: `NVU_GOOGLE_DESKTOP_CLIENT_ID` e `NVU_GOOGLE_DESKTOP_CLIENT_SECRET` (os valores do seu `desktop/windows/config/google-oauth.json` local; o repositório público guarda o segredo vazio de propósito).

A cada versão:
3. **Actions → "NVU Windows - versão da comunidade (SEM assinatura)" → Run workflow.** Ele constrói no Windows, roda os testes, instala e confere o resultado, gera a prova de origem (attestation) do GitHub e cria um **rascunho** de release (o instalador carrega o segredo OAuth, por isso não vai como artefato público).
4. Em **Releases**, abra o rascunho, baixe os arquivos, rode `Verificar-NVU.ps1` (deve dar `OK`) e o roteiro `ROTEIRO-TESTE-ETS2-ATS.md` nos dois jogos.
5. Só então **Publish release**. O texto do rascunho já explica o aviso do SmartScreen e como conferir o arquivo (SHA-256 e `gh attestation verify`).

Limites honestos: o aviso do SmartScreen aparece a cada versão nova (a reputação é por arquivo enquanto não houver assinatura), e computadores gerenciados por empresa podem bloquear. Isso é uma versão **da comunidade**, não "pronta para produção".

## 4. Se um dia contratar assinatura (opcional, pago)

Desde 1º/06/2023 as autoridades certificadoras exigem que a chave de certificados OV/EV fique em hardware certificado (token USB ou HSM na nuvem), então não existe "comprar um arquivo .pfx" para novos certificados. Para assinar pelo GitHub Actions o caminho é a assinatura na nuvem do fornecedor (por exemplo SSL.com eSigner ou DigiCert KeyLocker; OV costuma custar US$ 150–300/ano; EV não dá mais vantagem no SmartScreen). Cadastre os Secrets no ambiente `windows-release`:

- `NVU_SIGN_PFX_BASE64` + `NVU_SIGN_PFX_PASSWORD` (só se o fornecedor entregar um `.pfx`), **ou**
- `NVU_SIGN_COMMAND_JSON`: lista JSON com o comando que assina **um arquivo no lugar** (`{file}` é o caminho). Para serviços de nuvem isso pede um pequeno adaptador: me diga qual contratou.

Depois: **Actions → "NVU Windows release (signed)" → Run workflow.** Sem as credenciais ele para com `BLOQUEIO` e não publica nada; com elas, assina, instala o assinado, confere `Valid` + carimbo de tempo de cada arquivo e cria o rascunho de release.

## 5. Conferir antes de distribuir (qualquer caminho)

1. No Windows, `Verificar-NVU.ps1` deve mostrar `OK: tamanho e SHA-256 conferem` (e, se assinado, `Assinatura digital: Valid`).
2. Instale por cima de uma versão antiga e rode `ROTEIRO-TESTE-ETS2-ATS.md` no ETS2 e no ATS.
3. Guarde `release-manifest.json` e `SHA256SUMS.txt` junto do arquivo.

## 6. Critério de liberação como "produção"

Todos verdadeiros: assinatura válida com carimbo de tempo (`Valid`) **de um certificado que não seja autoassinado** (o campo `productionReady` do `release-manifest.json` só fica `true` nesse caso; o ensaio do CI, com certificado descartável, termina propositalmente com `productionReady: false` e motivo `SELF_SIGNED_CERTIFICATE`), CI "NVU Windows CI" verde na mesma versão, roteiro nos jogos aprovado (ETS2 e ATS), `npm run qa` aprovado na fonte final e nenhum bloqueador P0/P1 aberto em `qa/audit-blockers.json`. Sem assinatura o resultado é, no máximo, **versão da comunidade (candidata)**.
