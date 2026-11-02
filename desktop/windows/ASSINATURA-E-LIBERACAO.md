# Assinatura digital e liberação do instalador (NVU Windows)

Documento de quem publica a versão. Quem só instala usa o instalador e o `GUIA-ATUALIZAR-NVU-E-PREPARAR-ETS2-ATS.md`.

## 1. Onde estamos

- O instalador sai **sem assinatura**: `release-manifest.json` → `signing.status = unsigned`, `productionReady = false`. Sem certificado nem serviço de assinatura, nada é assinado e o fluxo de release **para** com o bloqueio exato.
- Assinar troca "Editor desconhecido" pelo nome verificado do editor e deixa a origem comprovável. **Não** promete que o SmartScreen deixe de avisar no começo: a reputação se constrói com o tempo e com o volume de downloads.
- Certificado autoassinado não vale confiança pública. O CI usa um descartável só para provar o encanamento (assinar, regenerar manifestos, conferir CRC do NSIS depois de assinar).

## 2. Por que não existe "comprar um arquivo .pfx"

Desde 1º/06/2023 as autoridades certificadoras exigem que a chave privada de certificados públicos de assinatura de código (OV e EV) seja gerada e guardada em hardware certificado (FIPS 140-2 nível 2 ou Common Criteria EAL 4+): token USB ou HSM na nuvem. Para assinar a partir do GitHub Actions, o caminho prático é a **assinatura na nuvem** do próprio fornecedor (a chave nunca sai do HSM).

## 3. Caminhos (pesquisados em 02/11/2026; confirme preço e elegibilidade na hora de contratar)

| Caminho | Serve? | Observação |
|---|---|---|
| **SSL.com eSigner** (OV ou EV na nuvem; CLI `CodeSignTool`) | Sim, é o mais direto para CI | O fornecedor anuncia assinatura a partir de pipelines sem token físico. Preços de tabela: OV ≈ US$ 129/ano; EV pessoa física ("sole proprietor") ≈ US$ 359/ano. [página do serviço](https://ssl.com/products/software-integrity/signing-service/) · [guia do CodeSignTool](https://www.ssl.com/guide/esigner-codesigntool-command-guide/) |
| **DigiCert KeyLocker** (nuvem; CLI `smctl`) | Sim | Assina no lugar, sem arquivo de saída. Costuma ser mais caro (confirme). |
| **Azure Artifact Signing** (antigo Trusted Signing) | Provavelmente **não** no Brasil | Segundo a Microsoft, pessoa física só nos EUA e Canadá; organizações nos EUA, Canadá, UE e Reino Unido. [opções de assinatura](https://learn.microsoft.com/en-us/windows/apps/package-and-deploy/code-signing-options) · [quickstart](https://learn.microsoft.com/azure/artifact-signing/quickstart) |
| **SignPath Foundation** (gratuito) | **Não** | Só para projetos de código aberto com licença OSI e sem componentes proprietários. [termos](https://signpath.org/terms) |

Validação de identidade (documentos da pessoa ou da empresa) é feita pelo fornecedor e pode levar dias. Isso só você pode fazer.

## 4. Depois de contratar: ligar ao GitHub (uma vez)

1. No repositório: **Settings → Environments → New environment → `windows-release`** (opcional: marque "Required reviewers" para exigir aprovação a cada release).
2. Dentro desse ambiente, **Add secret** para cada item:
   - `NVU_GOOGLE_DESKTOP_CLIENT_ID` e `NVU_GOOGLE_DESKTOP_CLIENT_SECRET`: o cliente OAuth Desktop do Google (o segredo **não** está no repositório; use o valor do seu arquivo local).
   - Assinatura, **um** dos dois jeitos:
     - `NVU_SIGN_PFX_BASE64` + `NVU_SIGN_PFX_PASSWORD`: só se o fornecedor entregar um `.pfx` (certificados antigos ou emitidos assim).
     - `NVU_SIGN_COMMAND_JSON`: lista JSON com o comando que assina **um arquivo no lugar**, onde `{file}` é o caminho. Para nuvem (SSL.com, DigiCert) isso exige um pequeno adaptador; **me diga qual fornecedor contratou** que eu ligo o fluxo e testo o encanamento com a sua conta.
3. **Actions → "NVU Windows release (signed)" → Run workflow.** Sem as credenciais o fluxo para com `BLOQUEIO` e não publica nada.

## 5. Conferir antes de distribuir

1. Abra **Releases** no repositório: o fluxo cria um **rascunho** (visível só para quem tem acesso de escrita; o instalador carrega o segredo OAuth, por isso não vai como artefato público). Baixe os arquivos dele.
2. No Windows: `Verificar-NVU.ps1` deve mostrar `OK: tamanho e SHA-256 conferem` e `Assinatura digital: Valid` com o seu nome de editor.
3. Instale por cima de uma versão antiga e rode o roteiro `ROTEIRO-TESTE-ETS2-ATS.md` nos dois jogos.
4. Só então clique em **Publish release** (ou distribua o arquivo). Guarde `release-manifest.json` e `SHA256SUMS.txt` junto.

## 6. Critério de liberação para produção

Todos verdadeiros: assinatura válida com carimbo de tempo (`Valid`), CI "NVU Windows CI" verde na mesma versão, roteiro nos jogos aprovado (ETS2 e ATS), `npm run qa` aprovado na fonte final e nenhum bloqueador P0/P1 aberto em `qa/audit-blockers.json`. Faltando qualquer um, o resultado é "candidata", nunca "pronta para produção".
