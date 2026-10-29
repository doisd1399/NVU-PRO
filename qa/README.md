# Qualidade automatizada NVU

O processo usa a base 1.0.520 / Web 2.3.197. Nenhuma Function ou regra é publicada ao rodar testes. As contas, empresas, operações e comprovantes são fictícios e ficam no Firebase local `demo-nvu-v36-4-staging`.

## Uso

Pré-requisitos: Node 22+, npm, JDK 21 (`JAVA_HOME`) e curl. No Linux, o Chromium também precisa das bibliotecas indicadas pelo Playwright (`npx playwright install --with-deps chromium`). O fluxo Android usa Android SDK 36, Build Tools 35 e um emulador/dispositivo conectado. Os scripts de release pressupõem Linux, macOS ou WSL.

Uma vez, na pasta do projeto:

```bash
npm ci
npm --prefix functions ci
npm run qa:setup
```

No dia a dia:

```bash
npm run qa
```

O setup também prepara os recursos locais de OCR e imagens, que são reconstruídos a partir das dependências e do modelo de idioma comprimido incluído no Git.

O robô executa compilação, contratos de confirmação, recuperação da fila, telas, imagens offline, políticas Java e integração Auth/Firestore/Storage com os handlers reais do backend. Ao final, abra `qa/results/latest.html`. Os resultados individuais e logs ficam na pasta datada do mesmo diretório. O comando retorna código diferente de zero quando uma etapa obrigatória falha ou fica indisponível.

Para uma versão Android:

```bash
npm run qa:release
npm run qa:gate
```

O perfil `release` exige também testes no Android. O pacote de teste `com.nvu.operacional.qa` tem outro armazenamento, outra assinatura e não possui permissão INTERNET. O teste instala somente esse pacote, abre o WebView local, verifica persistência e repete a abertura após `am force-stop`. Não desinstala nem limpa o aplicativo real `com.nvu.operacional`. O SDK e um Android/AVD precisam estar disponíveis. Sem eles, o resultado é `BLOCKED`, nunca aprovado.

Com as credenciais privadas de assinatura configuradas pelo proprietário, `npm run release:checked` executa a bateria completa antes do script de APK. O Gradle também confere a aprovação antes de `preReleaseBuild`, incluindo quem o aciona diretamente. O relatório precisa ser do perfil release, ter todas as etapas aprovadas, corresponder à fonte atual e ter menos de 24 horas. A fonte não pode mudar durante os testes. Nenhum APK é gerado por `qa` ou por `qa:quick`; o perfil release gera apenas APKs de teste isolados como parte do ensaio Android.

## Perfis

| Comando | Finalidade | Aprova APK? |
|---|---|---|
| `npm run qa:quick` | Retorno rápido com tipos, servidor e transportes controlados | Não |
| `npm run qa` | Bateria Web/Firebase, OCR e persistência reais no navegador, regras e políticas Java | Não |
| `npm run qa:release` | Bateria completa + Gradle/JUnit e APK em Android conectado | Apenas se tudo passar |
| `npm run qa:self-test` | Verifica falha, timeout, relatórios incompletos/antigos e isolamento de credenciais do próprio processo | Não |

`qa/config.json` é o catálogo das etapas obrigatórias. Não reduza o catálogo para contornar falhas; investigue a falha e acrescente o cenário de regressão correspondente.

## Auditoria de estabilidade de 26/10/2026

Consulte `qa/audits/2026-10-26/REPORT.md` para a revisão atual e `REPORT-original.html` na mesma pasta para o relatório histórico preservado. O relatório atual distingue a evidência recuperada, os testes reconstruídos e repetidos e a conferência somente de leitura da produção.

As correções reconstruídas e o limite de implantação estão em `qa/audits/2026-10-26/ROLLOUT.md`. Os pré-requisitos de backend de `ROLL-01` foram comprovados em `verification/rollout-2026-10-27/REPORT.md`. A geração de APK ainda exige QA release/gate atuais; adoção dos clientes e regras restritas são etapas posteriores.

A etapa `notifications` exercita o Provider e o efeito de popup React reais, com transportes controlados e as flags legadas padrão. O cenário de hidratação falha na base anterior e passa após a correção. Isso não comprova entrega FCM em aparelho.

Os perfis Web e quick continuam úteis enquanto existem problemas conhecidos. A aprovação de release e `qa:gate` ficam bloqueados por achados P0/P1 abertos em `qa/audit-blockers.json`, mesmo quando todos os testes funcionais passam. A política configurada ausente, corrompida ou com resolução sem evidência também bloqueia. Resolva a causa e registre evidências antes de alterar o estado de um achado.

## Cobertura e limites

| Camada | O que é exercitado |
|---|---|
| Contratos/recuperação | Código real com transporte e armazenamento controlados, incluindo ACK perdido, recusa e troca de conta |
| Ciclo operacional | Backend real e transações/regras locais: aprovação, identidade, designação, início, replay concorrente, progresso, finalização, acesso e remoção preservando outro vínculo |
| Metas e ranking | Regressões do backend usando o emulador de Firestore |
| Lançamento no navegador | RecordTrip e TripHistory reais, OCR real de fixture, IndexedDB, upload e callable HTTP reais; apenas o read model de sessão/operação é fixado nesse cenário |
| Aplicativo completo | App, providers e seletor reais com Auth local, abrindo Gestão da empresa correta; o login da fixture é feito pelo SDK local, não pelo OAuth Google |
| Imagens | Navegação e reabertura com imagens remotas bloqueadas, bytes em IndexedDB e separação por conta |
| Java sem Android | 27 testes das seis classes de políticas independentes do framework; não equivale aos 35 testes do app completo |
| Android completo | Perfil release: testes unitários Gradle e instrumentação real no APK QA, com dois processos e armazenamento preservado |

O processo não declara testados login real Google, a integração completa dentro do GTO, permissões específicas da Motorola, bateria ou latência de produção. Esses itens exigem um aparelho/jogo/acesso apropriado e podem ganhar um job dedicado depois. Emuladores locais também não substituem a validação dos índices e do desempenho do banco em produção.

## Execução contínua

O workflow `.github/workflows/nvu-quality.yml` está instalado na branch `qa/automated-tests-520` do repositório privado `doisd1399/NVU-PRO-ANDROID-382-RELEASE`. Pushes nessa branch iniciam os testes automaticamente. Ele executa Web/Firebase e depois o Android virtual API 36, guardando relatórios como artefatos. Não usa credenciais Firebase ou de assinatura do proprietário e não publica releases. A branch principal e sua proteção não foram alteradas. Para executar também nas alterações futuras da principal, incorpore a branch de QA após revisar os resultados.

GitHub Actions usa as condições e a franquia da conta/repositório. Este pacote não contrata nenhum serviço nem agenda cobrança.

## Segurança operacional

- Um único proprietário controla os emuladores; os testes de integração rodam em série porque limpam o mesmo banco fictício.
- Credenciais cloud e variáveis de assinatura não são encaminhadas aos filhos do processo de testes.
- O projeto demo é fixo. O navegador bloqueia hosts externos e o processo dos testes de integração limita HTTP/HTTP2 ao loopback.
- As dependências e os emuladores são baixados somente no setup; em execução, a ausência deles exige setup em vez de uma conexão com produção.
- JUnit e Hamcrest têm checksum SHA-256 fixo. O cache está em `.qa-cache`, separado de dados do aplicativo.
- Execuções simultâneas são bloqueadas. Se um processo for encerrado à força, confira o PID em `qa/results/running.lock` antes de remover um lock antigo.
- Relatórios são evidência de qualidade, não uma assinatura contra alguém com acesso de escrita ao próprio projeto.

## Acrescentar novos fluxos

Crie um cenário com dados fictícios em `qa/tests`, adicione-o ao catálogo apropriado e defina exatamente a camada coberta. Mantenha assertions sobre o resultado no banco, e não somente sobre um toast de sucesso. Não marque uma etapa indisponível como `PASS` nem transforme uma falha de produto em espera sem limite.
