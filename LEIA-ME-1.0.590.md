# NVU PRO 1.0.590 (Android) / Web 2.3.247 / Windows 0.2.16

Base atual do projeto (branch `dist-build`). **Uma única base**: Web (`src/`), Android (`android/`, `versionCode` 590 — instala como atualização da 589/588/587/586/585/584/583/582/581/580/579/578/577/576/575/574/573/572/571/570/569/568/567/566/565/564/563/562/561/560/559/558/557/556/555/554/553/552/551/550, sem limpar dados), Windows (`desktop/windows/`, 0.2.9, carrega o mesmo web) e servidor (`functions/`, `firestore.rules`, `storage.rules`).

## 1.0.590 — Carteira › Oferta: botão Recusar
- **A tela da oferta (Carteira) agora tem “Recusar”**, também quando o trabalho já foi encaminhado à fila do motorista (antes o botão só aparecia sem trabalho encaminhado). Toca em “Recusar” → aparece a confirmação (“Ao recusar, o trabalho sai da sua fila e você não recebe por ele.”) → “Confirmar recusa” ou “Voltar”.
- **Servidor:** recusar uma oferta com trabalho encaminhado **cancela o trabalho na fila do motorista** (só se ele ainda não foi iniciado; um trabalho já iniciado não é tocado) e avisa a empresa. A permissão é restrita: só o próprio motorista, só “cancelar” e só trabalho pendente.
- **Exige publicar a função `respondRewardOffer`** (sem a publicação, o app novo recusa a oferta, mas o trabalho continua na fila).

## 1.0.589 — Erro “exceeded the quota” ao iniciar um trabalho
- **Causa:** o armazenamento local do aparelho (poucos MB) ficou cheio, e a gravação do **início da operação** (fila local durável) foi recusada — o trabalho com pagamento era aceito, mas a operação não iniciava.
- **Correção:** ao faltar espaço, o app **libera só cache que ele mesmo refaz** (viagens em cache, ranking, páginas lidas, caches de gestão etc., do maior para o menor, só o necessário) e grava de novo. **Nunca apaga** fila de viagens, início/fim pendente, capa/foto ainda não enviada ou registros marcados como pendentes.
- **Fila local mais enxuta:** comandos já confirmados e vistos no servidor guardam só a identidade (sem o instantâneo completo do trabalho nem o recibo), o que também deixa cada leitura/gravação mais rápida.
- Se mesmo assim não houver espaço, aparece uma **mensagem clara** (com o caminho para limpar o cache do app) em vez do texto técnico, **sem janela bloqueante** (toast).
- Sem mudança no servidor (nada a publicar).

## 1.0.588 — Painel do motorista vira o menu (Trabalho atual)
- **O Painel do motorista agora abre sempre no menu**, com ou sem operação em andamento. **Escolher o perfil de motorista** (Alternar perfil / trocar de empresa como motorista) **cai nesse menu**.
- **Nova opção “Trabalho atual” no topo da lista.** Com operação em andamento, ela mostra o nome e o progresso e **abre a tela da operação** (a mesma de antes: card, veículo, finalizar etc.), com botão de voltar ao menu. Sem operação, fica desabilitada (“Nenhum em andamento”).
- **Ao iniciar um trabalho**, a tela da operação abre sozinha. Ao finalizar, volta ao menu (com o resultado da operação).
- Em “Ver Trabalhos”, com um trabalho em andamento, o pedido de trabalho dá lugar ao aviso “Finalize o trabalho atual…” e a fila não inicia outro trabalho.
- A aba **Atividade** continua mostrando a operação ativa como antes.
- Sem mudança no servidor (nada a publicar). **Windows 0.2.14** acompanha esta versão.

## 1.0.587 — Painel operacional: sem “Solicitar trabalho”, Perfil abre o Resumo do período
- **Removida a opção “Solicitar trabalho”** do Painel operacional (o pedido continua em “Ver Trabalhos”). A lista fica: Ver Trabalhos, Histórico de operações, Carteira, Perfil e Conquistas (em breve).
- **“Perfil” agora abre a página de Perfil com o Resumo do período** (a mesma do botão Perfil da barra inferior). Antes ele reabria o próprio painel, e parecia que nada acontecia.
- Sem mudança no servidor (nada a publicar).

## 1.0.586 — Carteira
- **Nova opção “Carteira” no Painel operacional** (entre “Histórico de operações” e “Perfil”): abre a página que antes se chamava “Trabalhos” (ofertas, recebimentos, histórico de ganhos e informações).
- **A página passou a se chamar “Carteira”** (título, link de voltar nos detalhes da oferta, janela de conclusão/Pix e atalho do painel). O botão “Trabalhos” **saiu do menu flutuante** do motorista.
- “Ver Trabalhos” (fila de trabalhos recebidos) continua como estava.
- Sem mudança no servidor (nada a publicar).

## 1.0.585 — Painel do motorista: lista de opções
- **Sem o card “Empresa vinculada”.** O painel mostra o **Status** e, logo abaixo, uma **lista de opções no mesmo desenho da Central de gestão**: **1. Solicitar trabalho** (envia o pedido; com pedido em andamento abre “Ver Trabalhos” para acompanhar/cancelar), **2. Ver Trabalhos**, **3. Histórico de operações**, **4. Perfil** (abre a página de perfil) e **5. Conquistas** (“Em breve”).
- **Ver Trabalhos** reúne **Solicitar trabalho**, **Trabalhos recebidos** (antes “Encaminhamentos da empresa”) e **Fila operacional**. A opção mostra a quantidade e “N nova(s)” quando há oferta de pagamento pendente.
- **Histórico de operações** abre a lista de trabalhos concluídos em tela própria (antes “Trabalhos anteriores”, recolhido no fim do painel). Nas duas telas há botão de voltar.
- Sem mudança no servidor (nada a publicar).

## 1.0.584 — Painel do motorista: card “Oferta de trabalho” compacto (layout aprovado)
- **O trabalho com pagamento ganha um card próprio** em “Encaminhamentos da empresa”: selo “Oferta de trabalho” dentro do card, etiqueta **Nova** (dourada; vira **Aceita** depois do aceite), nome da operação e **valor por viagem** lado a lado, faixa **Viagens · Teto · Prazo**, linha “**Restam 3d 23h.** Fora do prazo você finaliza, mas não recebe.” e o botão arredondado “Ver condições e iniciar”.
- **Mais compacto e com respiro:** números menores, mais espaço entre as faixas e menos altura vertical. Claro e escuro. Passado o prazo, a linha mostra “Prazo encerrado.” em vermelho.
- Operação comum e Parceria seguem como cartão recolhível (Entregas · Prazo + “Iniciar operação”).
- Sem mudança no servidor (nada a publicar).

## 1.0.583 — Fila de encaminhamentos redesenhada
- **Novo visual compacto e moderno** para “Encaminhamentos da empresa”: cada trabalho é um **cartão** (número, nome e resumo numa linha). A **Oferta de trabalho** ganha destaque (borda e fundo com a cor do tema), selo e, ao abrir, **blocos** com **Por viagem · Viagens · Prazo** (data e hora), um aviso curto (“Fora do prazo você finaliza, mas não recebe pelo serviço”) e **botão de largura total**. Antes o texto ficava espremido ao lado do botão.
- Operação comum segue simples (Entregas · Prazo + “Iniciar operação”). Claro e escuro.
- Sem mudança no servidor.

## 1.0.582 — Motorista: página “Trabalhos” e oferta de trabalho identificada na fila
- **A página do motorista passa a se chamar “Trabalhos”** (antes “Pagamentos”): título, botão do menu flutuante, seletor do painel e atalho. A área da empresa continua “Pagamentos”.
- **Em “Encaminhamentos da empresa”** o trabalho com pagamento agora tem o **selo “Oferta de trabalho”**, o nome em destaque e, ao abrir, as condições (“R$ 0,25 por viagem · prazo …; fora do prazo você finaliza, mas não recebe”). O botão passa a “Ver condições e iniciar”.
- **Janelas de condições/Pix/foto não ficam mais cobertas pela dock:** a janela “Trabalho com pagamento” (e a de conclusão e a da parceria) agora aparece **acima** da barra inferior, com todos os botões e informações visíveis.
- Sem mudança no servidor.

## 1.0.581 — Ranking: regra das parcerias corrigida
- **Parceria no ranking:** a empresa que **fez a oferta (contratante)** e o **motorista que fez o serviço** pontuam; a **empresa prestadora (que aceitou) não soma** essas viagens nem os ganhos (também fora da Central/histórico dela). Isto **restaura** o comportamento anterior do ranking (a v1.0.579 chegou a tirar as viagens de parceria de todo o ranking, o que derrubou a contratante). **Exige publicar as funções do ranking**; os totais voltam quando o agregado é recalculado.

## 1.0.581 — Pagamentos: excluir campanha cancelada do histórico
- Na **campanha cancelada** há o botão **“Excluir do histórico”** (com confirmação). Ela some das listas; os dados, os ganhos e os pagamentos já feitos continuam guardados. Campanha em andamento não pode ser excluída: primeiro se encerra.
- **Servidor:** nova função `hideRewardCampaign`. **Exige publicar a função.**

## 1.0.580 — Pagamentos: texto curto, foto do motorista e desempenho
- **Campanha com descrição curta:** a linha da lista mostra “R$ 0,25/viagem · 4 dias” (o nome da operação só aparece quando é diferente do nome da campanha, e o prazo não repete a palavra “prazo”). No detalhe, “Operação” some quando repete o título e “Prazo” mostra só “4 dias”.
- **Foto do motorista** nas listas de Pagamentos (motoristas da campanha, folha, em andamento, prontos para a folha, transferências e detalhe do pagamento); sem foto, as iniciais.
- **Botão “Escolher perfil” lento logo após atualizar:** a abertura do app deixava de baixar a Central/perfil ao mesmo tempo em que o usuário tocava; agora isso fica para quando o aparelho estiver ocioso (o seletor continua aquecido). A primeira abertura após atualizar ainda precisa preparar o app, então pode levar um instante.
- **Rolagem que trava e depois responde:** (1) o Feed de notícias gravava a posição de rolagem no armazenamento a cada quadro; agora só na pausa da rolagem; (2) as escutas de Pagamentos do motorista (ofertas, recebimentos e chave Pix) passaram a ser **uma só por motorista** (antes eram várias, e o Painel refazia a tela a cada atualização).
- Sem mudança no servidor (nada a publicar).

## 1.0.579 — Pagamentos: veículo, fila do motorista, edição, Pix ao concluir e comprovante conferido
- **Nova campanha com veículo:** seletor de veículo igual ao de “Encaminhar trabalho”. Ao enviar, o **trabalho entra na fila do motorista** (Painel → Encaminhamentos da empresa), pelo mesmo comando do encaminhamento comum. Quem não puder receber (suspensão, vínculo) sai da campanha e a empresa vê o motivo.
- **Ao iniciar o trabalho** o motorista vê as **condições** (valor por viagem, viagens, prazo) e aceita (“Aceitar e iniciar”). **Fora do prazo ele finaliza, mas não recebe pelo serviço** (rompe o acordo) — isso é dito antes de iniciar e também depois de vencido (“Iniciar sem pagamento”). O prazo do pagamento é o **mesmo do trabalho** (conta do encaminhamento).
- **Ao concluir** a operação: no prazo, o motorista **confirma/informa a chave Pix** que a empresa vai usar; fora do prazo, é avisado de que finalizou mas não recebe. A empresa recebe o aviso “operação concluída no prazo”.
- **Editar campanha em andamento** (nome, valor por viagem, meta): cada motorista é **avisado do que mudou** e vê “Atualizado pela empresa”. O valor por viagem fica travado quando já existe pagamento na folha. Encerrar a campanha tira da fila os trabalhos ainda não iniciados.
- **Menu flutuante do motorista:** botão **Pagamentos** logo abaixo de **Painel Operacional**.
- **Comprovante do pagamento:** para marcar como pago, a empresa **anexa o comprovante do banco**; o app **lê o valor** na imagem (no aparelho) e confere com o valor a pagar: igual → conferido; diferente → só segue se a empresa confirmar que a leitura está errada; sem leitura → segue como “valor não lido”. O motorista vê o comprovante e o resultado da conferência e ainda **confirma o recebimento**. Vale para **Pagamentos** e para **Parcerias** (a contratante anexa o comprovante; a executora vê).
- **Viagens de parceria não contam no Ranking** (nenhum) **nem na Central/histórico/ganhos da empresa prestadora**: aparecem só no **perfil do motorista** e na **empresa contratante** (resumo/histórico/relatórios).
- **Servidor:** `createRewardCampaign`, `cancelRewardCampaign`, `markRewardPaid`, `settlePartnershipPayment` atualizados; novo `updateRewardCampaign`; regras de **Storage** novas (`reward-receipts`, `partnership-receipts`) e ranking sem viagens de parceria. **Exige publicar funções e regras do Storage** (o ranking atual só se corrige quando o agregado é recalculado).

## 1.0.578 — Windows 0.2.4: dock em Parcerias/Pagamentos e botão Voltar
- **Dock visível em Parcerias B2P e Pagamentos** (empresa e motorista), com “Gestão/Trabalho” destacado. Estando nessas páginas, tocar no item destacado **volta para a página inicial** dele.
- **Voltar no Windows:** o aplicativo não tem o botão “voltar” do Android. Agora há um **botão ← no cabeçalho** (aparece quando existe uma página anterior), além de **Alt + ←** e do **botão “voltar” do mouse**. Se houver uma janela/seletor aberto, o voltar fecha primeiro essa janela.
- Windows **0.2.4** (a versão nova faz a janela perguntar se deve fechar a NVU anterior aberta).

## 1.0.577 — Windows 0.2.3: versão nova, foto do veículo inteira e fotos
- **Windows 0.2.3 (era 0.2.2):** a versão do aplicativo mudou para que, ao abrir esta NVU com uma anterior ainda aberta (inclusive escondida na bandeja), o programa **pergunte se deve fechar a anterior e abrir esta**. Com a mesma versão (0.2.2), o programa só reexibia a janela antiga — por isso o desktop parecia sem os recursos novos (Pagamentos etc.). A interface web embutida é a 2.3.234 (a mesma do APK).
- **Foto do veículo sem corte no desktop:** em janelas largas (≥ 768 px) a foto aparece **inteira** (sem cortar topo/base), nos cartões de Trabalhos ativos e no painel do motorista.
- **Fotos:** o aplicativo Windows passou a permitir também os endereços do armazenamento do Firebase (`*.firebasestorage.app`, `firebasestorage.googleapis.com`, `storage.googleapis.com`) para baixar/guardar fotos.

## 1.0.576 — Pagamentos: prazo, perda do pagamento e página do motorista
- **Só recebe depois de concluir a operação** (todas as viagens dela). Quem não concluiu não entra na folha.
- **Prazo da operação:** conta a partir do **aceite**. Viagens feitas depois do prazo não contam. **Prazo vencido sem concluir = o motorista perde o pagamento**; o que já tinha ganho aparece como “perdido” e não entra no total da campanha.
- **O motorista é informado:** antes de aceitar (“Sem concluir no prazo, você perde o pagamento”), durante o trabalho (prazo restante), **aviso quando faltam menos de 36 h** e **aviso quando o prazo vence** (“Prazo encerrado… perdeu o pagamento de R$ X”). Uma rotina diária (7h30, Brasília) fecha os prazos vencidos.
- **Empresa:** na campanha, o motorista com prazo perdido aparece como “Prazo perdido”; os que concluíram, como “Concluiu”.
- **Nova página do motorista no menu flutuante** (menu do painel → **Pagamentos**), com abas: **Ativos** (ofertas para responder e trabalhos em andamento, com prazo, progresso e ganho ao concluir), **Recebimentos** (pagamentos e chave Pix), **Histórico** (conclusões, prazos perdidos, recusadas e total recebido) e **Info** (ganhos, trabalho, dia de pagamento e como funciona).
- **Servidor:** novo agendamento `rewardDeadlineTick`; `respondRewardOffer`, `syncRewardTrips`, `generateRewardPayroll` e `rewardPayDayTick` atualizados. **Exige publicar as funções.**

## 1.0.575 — Novo visual da Nova campanha (Pagamentos)
- **Campos empilhados**, um por linha, com a dica na **mesma linha do título** (sem quebra de texto).
- **Resumo em lista compacta** (Total de viagens · Estimativa da meta · Total a pagar), com mais respiro entre as informações.
- **Lista de motoristas enxuta:** caixa, foto e nome, com rolagem própria — aproveita melhor a área visível.

## 1.0.574 — Pagamentos: formulário compacto e seção de informações do motorista
- **Sem sugestão de valores:** os campos de valor ficam vazios.
- **Descrições curtas:** valor por viagem — “Sugerimos pagamentos em centavos.”; meta — “Total de ganhos por operação.”
- **Nova campanha mais compacta:** valor por viagem e meta lado a lado, resumo em uma faixa (total de viagens · estimativa da meta · total a pagar) e lista de motoristas com rolagem própria, para caber melhor na área visível.
- **Motorista — aba “Informações”** (em Pagamentos): **Ganhos** (acumulado, a receber, recebido), **Trabalho** (operação, viagens x/N, valor por viagem, meta), **Dia de pagamento** de cada empresa e **Como funciona** em 4 passos curtos.
- **Servidor:** o dia de pagamento da empresa é copiado para as ofertas (novas e abertas), para o motorista vê-lo. **Exige publicar as funções** `createRewardCampaign` e `setRewardPayDay`.

## 1.0.573 — Meta de ganhos da operação
- A meta agora se chama **Meta de ganhos da operação**: é o **total de ganhos gerados em todas as viagens da operação** (a soma do valor de cada viagem da operação, depois do aceite do motorista). Continua separada do pagamento por viagem e não altera o valor pago.
- Ajustado o nome em todo o app: formulário (“3. Meta de ganhos da operação”), detalhe da campanha, oferta do motorista (“Meta da operação”, “Ganhos na operação”, barra de progresso) e aviso de nova oferta.

## 1.0.572 — “Salário” vira **Pagamentos** e telas mais enxutas
- **Nome da área:** agora é **Pagamentos** (Central de gestão, painel do motorista, títulos e avisos: “Nova oferta de pagamento”, “Pagamento a receber”). O campo de valor passou a se chamar “Valor por viagem”.
- **Sem cálculos escritos na tela:** o resumo da Nova campanha mostra só os resultados — **Total de viagens**, **Estimativa da meta** e **Total a pagar** — sem fórmulas.
- **Textos mais curtos** nas telas de campanha, folha, transferências, ofertas e recebimentos (descrições, dicas e avisos reduzidos ao essencial).

## 1.0.571 — Salário: meta de ganhos no simulador separada do salário por viagem
- **Duas coisas diferentes, sem ligação entre si:**
  - **Salário por viagem** = o que a empresa paga ao motorista por viagem feita na operação (é isso que entra na folha e no Pix).
  - **Meta de ganhos no simulador** = uma meta para o motorista atingir em ganhos realizando as viagens no jogo. Não altera o salário nem o teto. O app soma o ganho das viagens da operação (o valor registrado em cada viagem) e mostra o progresso ao motorista e à empresa.
- **Formulário:** 1. Operação → 2. Salário por viagem → 3. Meta de ganhos no simulador (opcional) → Motoristas → 4. Nome. Os dois campos de valor não se recalculam mais.
- **Resumo no final:** **Total de viagens** (1 operação de N viagens × motoristas), **Estimativa da meta** (soma da meta de cada motorista selecionado, ex.: R$ 600 × 2 = R$ 1.200) e **Salário total a pagar** (total de viagens × salário por viagem).
- **Folha:** o salário entra quando o motorista conclui a operação (faz todas as viagens dela); quem não concluir na semana recebe na semana seguinte.
- Oferta do motorista: salário por viagem, viagens (x de N), salário acumulado, ganhos no simulador (x de meta) e barra de progresso.

## 1.0.570 — “Recompensas” passa a se chamar **Salário** e seletor de motoristas igual ao Encaminhar trabalho
- **Nome:** a área (antes “Recompensas”) agora é **Salário**: é onde a empresa paga o motorista pelos serviços prestados. Mudou na Central de gestão, no painel do motorista, nos títulos das telas, nos avisos (“Nova oferta de salário”, “Salário a receber”) e no comprovante (“COMPROVANTE DE PAGAMENTO”). Os endereços internos e o servidor não mudaram.
- **Motoristas da campanha:** mesmo seletor do “Encaminhar trabalho” — título **Motoristas**, contagem de selecionados, **Selecionar todos**, e cartões com caixa de seleção, foto e nome. Começa sem ninguém marcado; a oferta vai só para quem estiver marcado.

## 1.0.569 — Recompensas: investimento total = o que o empresário paga aos motoristas
- **Investimento total a pagar aos motoristas** = **total de viagens (bruto) × valor por viagem**, em centavos, sem arredondar. Ex.: viagem de R$ 0,10 com 36 viagens no total = R$ 3,60.
- O resumo mostra o cálculo na própria linha (“36 viagens × R$ 0,10”) e, no texto abaixo, o total se todos os motoristas atingirem a meta (ex.: meta de R$ 600 × 2 motoristas = R$ 1.200).

## 1.0.568 — Recompensas: prazo da operação, pagamento só de quem concluiu e formulário empilhado
- **Sem início e fim:** o prazo é o da operação. A campanha vale a partir do envio e fica aberta até ser encerrada; só contam viagens da operação depois do aceite do motorista.
- **Meta de ganhos = total que o motorista alcança ao concluir a operação.** Valor por viagem e meta andam juntos: mexer em um recalcula o outro (meta = valor por viagem × viagens da operação). Os dois campos ficam **empilhados**.
- **Formulário:** 1. Operação → 2. Valor por viagem → 3. Meta de ganhos → 4. Quem participa → 5. Nome. O resumo mostra só o essencial: **viagens no total** (ex.: 1 operação de 10 viagens × 2 motoristas = 20 viagens) e o **total de ganhos se todos atingirem a meta** (ex.: meta de R$ 600 × 2 motoristas = R$ 1.200).
- **Pagamento no dia do pagamento, só de quem concluiu a operação:** a folha (automática ou manual) inclui apenas motoristas que alcançaram a meta. Quem não concluiu na semana entra na folha da semana seguinte em que concluir. A tela Folha mostra “Pronto para a folha” e “Ainda não concluíram” (com “x de N viagens”).
- Oferta do motorista: prazo da operação, meta de ganhos, progresso e o aviso de como funciona o pagamento.

## 1.0.567 — Recompensas: meta de ganhos no formulário e conta automática
- **Meta de ganhos por motorista é definida no formulário** (campo “3. Meta de ganhos”). Em branco vale o máximo da operação (viagens × valor por viagem). Não pode passar desse máximo.
- **O empresário não digita mais viagens:** elas vêm da operação escolhida (o servidor usa o total de entregas da operação).
- **O app soma e mostra:** viagens da operação, motoristas, **total de viagens (motoristas × viagens)**, valor por viagem, meta por motorista e **investimento total** (motoristas × o que cada um pode ganhar). Ex.: 3 motoristas × 12 viagens = 36 viagens; meta R$ 200 → investimento R$ 600.
- **Regra no servidor:** o ganho do motorista para exatamente na meta (a última viagem credita só o que falta); só contam viagens da operação, depois do aceite e dentro do período.
- Oferta do motorista: meta de ganhos, barra de progresso e quanto falta.

## 1.0.566 — Recompensas: prévia da operação e conta da meta
- **Prévia da operação igual à lista “Escolher operação”:** depois de escolher, o formulário mostra o mesmo cartão da lista (ícone, nome, reboque, entregas e dias); tocar nele reabre a lista para trocar.
- **O app calcula a conta e mostra cada passo:** meta por motorista (viagens × valor por viagem) e custo máximo (motoristas × meta), por exemplo 12 × R$ 25,00 = R$ 300,00 e 3 × R$ 300,00 = R$ 900,00.
- A meta é alcançada **realizando as viagens dentro da operação**. Na oferta, o motorista vê a **barra de progresso** e quantas viagens faltam; na campanha, a empresa vê “x de N viagens” por motorista.

## 1.0.565 — Recompensas: formulário simples por operação e correções
- **Teclado fechando a cada letra (corrigido):** os campos da “Nova campanha” eram recriados a cada letra digitada; agora ficam fixos e o teclado não fecha.
- **Nova campanha mais simples e inteligente**, na ordem: **1. Operação** (usa o mesmo seletor “Escolher operação” do Designar trabalho: busca, pastas e rolagem própria) → **2. Valor por viagem** → **3. Viagens da operação** (já vem com o total de entregas da operação) → **4. Quem participa** → **5. Início e fim** → **6. Nome** (em branco usa “Campanha + nome da operação”).
- **Meta de valor ao concluir a operação** = valor por viagem × total de viagens (ex.: R$ 25 × 12 = R$ 300 por motorista). **Teto automático** = motoristas × meta. Não há mais bônus por meta no formulário (campanhas antigas continuam funcionando).
- **Regra no servidor:** só contam viagens **da operação escolhida**, e cada motorista recebe por **até** o limite de viagens definido. O servidor confere que a operação é da empresa.
- A oferta do motorista mostra a **operação** e o **limite de viagens**.
- **Dia do pagamento / erros:** mensagens como “internal [0]” agora aparecem como texto claro. (Esse erro ocorria porque as funções da fase 2 ainda não estavam publicadas no servidor.)

## 1.0.564 — Recompensas (fase 2: folha, Pix, comprovante, Recebimentos e Transferências)
- **Empresário → Recompensas** agora tem 3 abas: **Campanhas**, **Folha** e **Transferências**.
  - **Folha:** escolhe o **dia da semana do pagamento**. Nesse dia, às 8h (Brasília), o NVU **monta a folha sozinho** (ganho de cada motorista que ainda não foi pago) e avisa a gestão; também dá para **Gerar folha agora**. Cada valor entra em **uma só folha** (sem pagar duas vezes).
  - **Pagar por Pix:** em cada motorista aparecem a **chave Pix**, o valor, o **Pix copia e cola** e o **QR Code** do valor exato. A empresa paga no app do banco e toca em **Marcar como pago** (com o código da transação opcional). O NVU gera o **comprovante** (número RC-…, data, valor, pagador, recebedor, chave parcialmente escondida) para as duas partes.
  - **Transferências:** pagamentos feitos, com comprovante e a situação da confirmação do motorista.
- **Motorista → Recompensas → Recebimentos:** cadastra a **chave Pix**, vê o que vai receber, o comprovante e **confirma o recebimento** ou **contesta** (“não recebi / não confere”, com motivo). A empresa é avisada e responde pagando de novo (novo comprovante) ou cancelando o pagamento (o valor volta para a próxima folha). Recebido e cancelado são finais.
- **Importante:** o dinheiro **não passa pelo NVU**; o comprovante é um **registro do NVU** a partir do que a empresa informou, não um comprovante bancário.
- Servidor novo: `setRewardPayDay`, `setRewardPix`, `generateRewardPayroll`, `markRewardPaid`, `confirmRewardReceived`, `contestRewardPayment`, `cancelRewardPayment`, agendamento `rewardPayDayTick` (diário, 8h); regras `rewardSettings` / `rewardPayees` / `rewardPayments` (escrita só pelo servidor). **Exige publicar funções e regras.**
- Nova dependência: `qrcode-generator` 2.0.4 (QR Code gerado no próprio aparelho).
- Testes: `scripts/test-rewards.mts` (14 verificações, inclui o CRC do Pix) e `scripts/test-reward-payments-emulator.mjs` (7 cenários no emulador: folha, pagar, contestar, cancelar, agendamento, regras). O QR gerado foi lido por um decodificador independente e o texto bate com o copia e cola.

## 1.0.563 — Recompensas (fase 1: empresa → motoristas da própria equipe)
- **Empresário:** Central de gestão → **Recompensas**. Cria campanha (nome, período de até 92 dias, todos ou motoristas escolhidos, **valor fixo por viagem**, **bônus de meta** opcional e **teto de investimento**) com **simulador do custo máximo**. Acompanha ganhos por motorista e pode **encerrar** a campanha.
- **Motorista:** card **Recompensas** no painel → vê as ofertas, **aceita ou recusa** e acompanha o ganho acumulado.
- **Regra de contagem (no servidor):** só contam viagens **confirmadas pelo servidor**, da empresa da campanha, **depois do aceite** e dentro do período; sem duplicar; o bônus entra ao atingir a meta; ao chegar no teto a campanha para de creditar e a empresa é avisada.
- **Nesta fase o NVU só calcula e registra o ganho.** O pagamento é combinado e feito pela empresa diretamente ao motorista; **fechamento semanal, folha, Pix copia-e-cola, comprovante, Recebimentos/Transferências e contestação ficam para a fase 2.**
- Servidor novo: `createRewardCampaign`, `respondRewardOffer`, `cancelRewardCampaign`, `recomputeRewardCampaign`, gatilho `syncRewardTrips`; regras `rewardCampaigns` / `rewardOffers` (escrita só pelo servidor). **Exige publicar as funções e as regras** para funcionar.
- Testes: `scripts/test-rewards.mts` (política) e `scripts/test-rewards-emulator.mjs` (emulador), no `npm run qa`.


## O que mudou desde a 550 — Parcerias B2P

### 1. Painel de parcerias no estilo da Central de gestão (telas refeitas)
- Cabeçalho igual ao da Central: **título e descrição centralizados**, nome da empresa e simulador.
- Abas simples: **Painel · Ofertas · Carteira · Histórico** (em Ofertas: **Recebidas / Enviadas**).
- **Painel:** resumo (A receber / A pagar, em andamento, para responder, concluídas), "Parcerias ativas" com **+ Nova oferta** e cartões de operação no desenho de "Trabalhos ativos" da Central (viagens, restantes, concluído, prazo restante, "Pontuação para …"), e "Ver ofertas →".
- **Ofertas:** cartões com viagens, prazo (em dias) e valor; botões **Analisar / Recusar** (ou **Designar trabalho** quando aceita) e **Cancelar oferta** nas enviadas.
- Sem cartões decorativos, balões flutuantes, barras fixas nem seletores com informações pré-preenchidas: formulários compactos, botões simples.
- Linha **Parcerias B2P** da Central ganhou **indicador** (oferta para responder, aceite, conclusão etc.); abrir a página zera as novidades.

### 2. Nova oferta (contratante) — formulário curto
Empresa parceira (busca com resultado na própria tela; só empresas **ativas do mesmo simulador**), Operação (nome, viagens | prazo em dias), reboque opcional, condições do acordo (até 300 caracteres), **valor do acordo** (opcional) e meta (opcional). **O veículo não faz parte da oferta**: quem escolhe é a executora.
O prazo em dias **só começa a contar quando a parceira aceita**.

### 3. Designar trabalho (executora)
Motorista da própria equipe (lista), **veículo da própria frota** (a janela "Escolher veículo" da Central), reboque (obrigatório só se a oferta exigir). O motorista precisa **fotografar o veículo para iniciar** (exigido pelo servidor), com o aviso "Essa operação é um acordo entre empresas, conclua a operação dentro das especificações."

### 4. Valor do acordo, prazo e carteira
- O contratante pode informar um **valor do acordo** (negociado entre as empresas, fora do NVU; o app só registra e calcula).
- **Concluída fora do prazo: −25%** sobre o valor combinado, calculado pelo servidor e mostrado em todas as telas (valor combinado, desconto, valor final).
- Ao concluir, o app calcula **valor a pagar** (contratante) e **valor a receber** (executora). O contratante marca **Pago**; a executora **Confirma o recebimento** (pode confirmar mesmo antes do "Pago"). Nada volta atrás; o outro lado é avisado.
- **Carteira** da empresa: **ganhos em parcerias** (quando executa) e **investimento em parcerias** (quando contrata), com filtros e situações Previsto / A pagar / A receber / Pago / Liquidado.
- **A carteira é um registro contábil dentro do app. Nenhum dinheiro passa pelo NVU.**

### 5. Ajustes finais pedidos após testar no aparelho
- **Reboque** (Nova oferta e Designar trabalho): agora usa a lista de seleção no mesmo estilo da lista de veículos (busca, cartões com rádio, "Cancelar / Usar reboque"; na designação, os que não atendem à exigência aparecem bloqueados com o motivo).
- **Nada vem preenchido**: nome da operação, viagens e prazo abrem vazios (só "Repetir oferta" copia viagens, prazo, reboque e valores da oferta anterior — o nome fica em branco).
- **Sem azul nos itens selecionados**: abas, filtros, linhas selecionadas, botões de rádio e o foco dos campos usam tons neutros do próprio tema.

### 6a000000. Ajuste da 1.0.562 — viagens da parceria nos números da contratante, excluir canceladas e chave Pix
- **Viagens da parceria** passam a contar também para a **contratante** no *Resumo operacional* (ganhos do período, viagens, meta), no *histórico de viagens*, nos *relatórios* e nos *Resultados da empresa* — como o ranking já fazia. Lidas do livro do acordo (documento da parceria); a executora continua contando as viagens como suas. As viagens entram com valor, data, motorista, operação e veículo (rota/carga não existem no livro). **Só cliente, vale já.**
- **Excluir operação cancelada/recusada**: botão de lixeira no Histórico das Parcerias; some só da lista de quem excluiu. **Precisa publicar a função `hidePartnership`.**
- **Chave Pix do recebimento**: a empresa que recebe (executora) informa a chave (CPF, CNPJ, telefone, e-mail ou aleatória, validada) na tela da parceria; a que paga (contratante) vê a chave, copia e paga fora do NVU; ao concluir, a contratante é avisada ("Pague R$ … Chave Pix …") e a executora é lembrada de informar a chave se faltar; depois "Marcar como pago" → "Confirmar recebimento", como antes. **Precisa publicar `setPartnershipPix` e o gatilho `syncPartnershipFromJob`.**

### 6a00000. Ajuste da 1.0.561 — aceitar parceria e logo da empresa
- **Erro ao aceitar** ("a sua empresa precisa estar preparada para a confirmação operacional… [400]"): a empresa executora (ex.: MATECOM) não tinha a confirmação operacional ligada (`operationalCommandVersion` 1), que o servidor exige para aceitar. Agora, nesse caso, a oferta mostra o aviso e o botão **Preparar e aceitar**: liga o recurso pelo mesmo comando da fila automática (o servidor só liga se não houver trabalhos simultâneos em conflito; se houver, mostra o motivo) e aceita a oferta em seguida. Só cliente; **nada a publicar** no servidor.
- **Logo da empresa** nas telas de Parcerias: aparecia cortada (preenchimento); agora aparece inteira dentro do quadrado arredondado. Foto de motorista continua preenchendo o círculo.

### 6a0000. Ajuste da 1.0.560 — card das parcerias igual ao de Trabalhos ativos e foto do veículo
**Card da operação (Parcerias B2P e Trabalhos ativos)**
- Em **Parcerias B2P** (Painel → Parcerias ativas e a tela de Detalhe) a operação agora é o **mesmo card de "Trabalhos ativos"** da Central: **recolhe e expande pela seta**; ao expandir mostra a **foto do veículo** (a cadastrada; a contratante vê mesmo antes de o motorista iniciar), botão de pinturas, ⓘ, entregas/restantes/concluído e "Tempo restante" no mesmo formato (`3d · 22h · 4min`). A faixa "Parceria · Executada por / Contratada por (empresa)" é a da Central; o rodapé "Contratado por" deixou de existir porque o card é o mesmo.
- Em **Trabalhos ativos**, o **ⓘ** de uma operação executada por outra empresa **abre o card "Informações da operação" no próprio lugar** — não leva mais à página de Parcerias. Só o botão **Resultados** do card leva à página de Parcerias (tela de resultados). Sem os dados da parceria no aparelho (offline), abre o card comum só para informar.
- O "tempo restante" da página de Parcerias anda de minuto em minuto, como na Central. O nome da empresa mostra só o primeiro e o segundo nome.

**Foto do veículo — "VEHICLE_PHOTO_DECODE_INVALID" (para alguns motoristas funciona, para outros não)**
- **Causa:** ao escolher a foto, o app a abria **inteira** num `<img>` só para validá-la e recusava mais de 40 MP; depois a decodificava de novo para reduzir. No Android o WebView só decodifica imagens até um tamanho que depende da memória do aparelho; fotos de câmeras de 48/50/64/108 MP (ou HEIC) caíam nessa recusa — por isso variava de motorista para motorista. Medido no Chromium: uma foto de 50 MP decodificada inteira ocupa ~200–260 MB e uma de 108 MP ~555 MB.
- **Correção (`src/lib/vehiclePhotoPrepare.ts`):** a foto nunca é decodificada no tamanho original. Lê só o cabeçalho (tipo real, dimensões, rotação EXIF — não confia no `file.type`); JPEG é decodificado **já em escala reduzida (n/8)** com `ImageDecoder` (~25× menos memória: 50 MP ≈ 8–40 MB; 108 MP também entra); demais formatos / WebView antigo usam `createImageBitmap` com redução e limite pela memória do aparelho; último recurso `<img>`. Sai em WebP (ou JPEG se o WebView não gravar WebP) até 1280 px / 800 KB, com a miniatura de antes.
- **Limite do arquivo escolhido: 20 MB** (antes 10 MB). É seguro porque a foto é lida em fluxo e reduzida; o que sobe ao Storage continua pequeno (< 2 MB) e o armazenamento local guarda só a versão reduzida.
- **Mensagens claras** no lugar do código: arquivo vazio/não lido (foto só na nuvem), maior que 20 MB, não é imagem, HEIC/HEIF (explica como trocar para JPG), resolução alta demais para o aparelho, arquivo corrompido, demorou demais. O código técnico continua em `error.code` e o que foi tentado fica no console.
- A **foto de início da parceria** (galeria → inicia a operação) usa a mesma preparação antes de enviar (até 1600 px / 1,2 MB). A prévia da foto original só aparece quando ela é pequena (≤ 3 MB); nas grandes aparece "Salvando…" e depois a foto pronta.
- **Não alterado:** capa e foto do perfil e logotipo continuam com a checagem e o limite de 10 MB anteriores (mesma causa, fora deste pedido).

### 6a000. Ajuste da 1.0.559 — textos do card da parceria
- O card da operação nas telas de Parcerias (Painel e Detalhe) **não mostra mais "Você contratou" / "Você executa"**: embaixo do nome do motorista aparece só o nome da empresa.
- O rodapé do card passou de "Pontuação para (empresa)" para **"Contratado por (empresa)"** (nome curto da contratante).
- A linha do **Histórico** também deixou de mostrar "Você contratou/executa" (fica o nome da empresa e a data).
- As frases explicativas da regra de ranking (tela de oferta recebida e de designar trabalho) não foram alteradas.

### 6a00. Ajuste da 1.0.558
- **A contratante vê o veículo da operação executada por outra empresa antes do início:** ao expandir o card (ex.: operação do Dudu Tv "Não iniciado"), aparece a **foto cadastrada do veículo** do motorista (a mesma projeção pública que o Ranking usa). A foto tirada ao iniciar continua como reserva. Se o veículo não tiver foto cadastrada, o card avisa "Este veículo ainda não tem foto cadastrada".

### 6a0. Ajustes da 1.0.557
- **Ícone de informações padrão:** nos cards de parceria o botão ⓘ é o mesmo da Central e do motorista (ícone pequeno, sem círculo extra em volta).
- **"Informações da operação" da parceria igual à do motorista/Central:** mesmo desenho (motorista, operação e situação, lista Veículo · Reboque · Entregas · Prazo · Restante, barra e ações). O acordo entra como linhas extras (Valor do acordo; A pagar/A receber com a situação do pagamento).
- **Foto do motorista da parceria:** quem vê a operação executada por outra empresa (ex.: contratante vendo o motorista da executora) agora mostra a **foto do perfil público** do motorista, nos cards da Central, nos cards de Parcerias e na folha de informações. Não depende de publicar nada no servidor.
- **Nome da operação × nome do reboque:** conferido no servidor (teste no emulador): o trabalho do motorista usa exatamente o **nome digitado na oferta**; o reboque vai só no campo de reboque. Se uma oferta já existente foi criada com o nome igual ao do reboque, o nome continua assim (é o que está gravado na oferta); a nova validação (publicada) impede novos casos.

### 6a. Ajustes da 1.0.556
- **O reboque é da CONTRATANTE.** Quem monta a oferta escolhe o reboque (lista da frota da contratante, sem digitar nome livre); a executora **não escolhe nem precisa ter** esse reboque. O trabalho do motorista mostra o nome do reboque da oferta, como numa operação comum. O nome da operação não pode ser igual ao nome do reboque (app e servidor recusam).
- **A foto de início inicia a operação sozinha**: ao escolher a foto na galeria, ela é enviada e a operação começa; a janela fecha na hora e a tela da operação aparece (o botão só reaparece como "Tentar novamente" se algo falhar).
- **Operação de parceria em andamento aparece como operação comum** (nome da operação no selo, reboque uma única vez).
- **Designar com operação em andamento:** se o motorista escolhido já está com uma operação em andamento, a executora decide: **cancelar a atual e iniciar a da parceria** (as viagens já registradas ficam preservadas) ou **manter a atual** (a parceria entra na fila e inicia depois que ele finalizar).
- **"Informações da operação"** do painel do motorista: o reboque aparece menor, em uma linha. No **painel da empresa**, a folha ganhou o mesmo desenho compacto (motorista, operação e situação, lista Veículo/Reboque/Entregas/Prazo/Restante e as quatro ações em grade 2×2).
- **Linha "Parceria · Executada/Contratada por …"** dos cards da Central: texto menor, com respiro acima e abaixo.
- **Servidor:** `designatePartnershipDriver` (reboque definido pela oferta; opção `cancelRunning`) e `createPartnershipOffer` (nome ≠ reboque) mudaram e precisam ser **republicadas** para o app novo funcionar por completo.

### 6b. Correção da 1.0.555 — foto de início da parceria pela galeria
O motorista agora **escolhe a foto do veículo na galeria** ao iniciar uma operação em parceria (antes o campo forçava a câmera). O botão passou a "Escolher foto do veículo" e o texto orienta a usar a galeria. A foto continua obrigatória e o servidor continua exigindo a URL da foto para iniciar.

### 6b. Ajustes da rodada anterior (1.0.554)
- **Nova oferta compacta:** sem rótulos repetidos (o texto do campo é o próprio rótulo; "viagens"/"dias" só aparecem depois de preencher), menos espaçamento e uma única observação sobre o prazo.
- **Cabeçalho igual ao da Central em todas as telas de Parcerias** (título e descrição centralizados, empresa e simulador): Nova oferta, Oferta recebida, Designar trabalho, Detalhe e Resultados.
- **Seletor de empresas** no mesmo estilo dos de reboque e veículo (tela de seleção com busca; nada de lista aberta sob a barra), **sem o nome do simulador**. A busca também encontra pelo nome completo.
- **Logo da empresa quadrada com cantos arredondados** e **só o primeiro e o segundo nome da empresa** nas listas, cartões e carteira (o cabeçalho da sua própria empresa continua como na Central).
- **Números com ponto nos milhares e vírgula nos centavos** (R$ 25.000,00): os campos de valor e de meta têm máscara; leitura e exibição usam o mesmo formato.
- **Valor por viagem:** escolha entre "Valor total" e "Valor por viagem"; no segundo, o app calcula o total da operação (viagens × valor) e mostra também o valor se concluir fora do prazo (−25%). O servidor continua guardando o valor total.
- **Lista de ofertas refeita no desenho das listas de opções da Central:** agrupada ("Aguardando sua resposta", "Aceitas — falta designar o trabalho", "Aguardando resposta da parceira"); cada oferta é uma linha com a logo quadrada da empresa à esquerda, o nome da operação e o status ("Responder", "Designar", "Aguardando"…) alinhados no topo, "Empresa · recebida/enviada há 2 h" e os dados em uma linha (viagens • prazo • valor), com seta à direita. Tocar abre os detalhes, onde ficam Aceitar/Recusar, Designar e Cancelar oferta.
- **Mais respiro e resumo compacto:** espaçamentos maiores no Painel, Ofertas e Detalhe. O detalhe da parceria mostra o card da operação (com botão ⓘ) e, abaixo, uma lista curta (ganhos nas viagens, duração, valor do acordo e, concluída, a pagar/receber e situação do pagamento). Todo o resto — partes, prazos, condições, motorista/veículo/reboque, foto de início, detalhamento do pagamento (−25%), Resultados e Repetir oferta — fica em "Informações da operação" (ⓘ ou "Mais informações da operação").
- **"Informações da operação" do painel do motorista (operação em andamento) refeita e enxuta:** título pequeno, nome da operação com a empresa e o selo de situação ("Em andamento" ou "Prazo excedido"), e uma lista com só o essencial — Veículo, Reboque, Viagens, Ganhos, Prazo (limite e total juntos) e Restante/Atraso (com o tempo em execução logo abaixo). Saíram as linhas repetidas (Empresa, Número de viagens, Prazo limite/Prazo total separados, Execução) e o aviso "Status da operação", que repetia o selo. O modal de operação finalizada não mudou.
- **Sem molduras genéricas de foco** (quadrado em volta da busca, de botões e de opções) nos campos de Parcerias e nas listas de seleção abertas a partir delas.

### 7. Parceiras ativas do mesmo simulador
A lista vem do **catálogo público** de empresas (antes lia só as empresas do usuário): ativas, não arquivadas/suspensas, do mesmo simulador (identidade canônica, GTO = Global Truck Online etc.). O servidor repete as regras ao enviar.

### Publicação
Funções novas/alteradas das Parcerias: `createPartnershipOffer`, `respondPartnershipOffer`, `cancelPartnershipOffer`, `designatePartnershipDriver`, **`settlePartnershipPayment` (nova)** e gatilhos `syncPartnershipFromJob`, `syncPartnershipTrips`; regras de Firestore e Storage. Também foram alteradas funções **já existentes em produção** (`operationalCommand`, `registerCanonicalSimpleTrip`, `registerGtoProReceipt`, funções de ranking, filas operacionais): a publicação delas é **uma decisão à parte**.

## Verificação (o que foi e o que NÃO foi provado)
- `npm run qa` (gate completo). Novo passo `vehicle-photo-prepare` (Chromium real): cabeçalhos JPEG/PNG/WEBP/GIF/AVIF/HEIC, fotos de 12/50/108 MP, rotação EXIF 1/3/6/8, PNG/WEBP/AVIF, 20 MB exatos × 20 MB + 1 byte, falhas com mensagem, WebView sem `ImageDecoder` e com limite de memória. Passo `partnerships`: 47 verificações (oferta com prazo em dias e valor, paridade da liquidação servidor × app, passos de pagamento, carteira, lista de parceiras, guardas de "sem veículo na oferta").
- Emulador, 13 cenários, incluindo liquidação pelo gatilho `syncPartnershipFromJob`.
- A leitura de fotos grandes foi provada no **Chromium (desktop)**; o limite de decodificação por memória do **WebView do Android não foi reproduzido neste ambiente** e a correção **não foi testada em aparelho**. Telas conferidas no navegador (claro e escuro) com dados de exemplo e fluxos executados (enviar oferta com valor, aceitar, designar, marcar como pago) com o payload dos serviços verificado. **Não** vistas com dados reais num aparelho.
- **Regras de Storage da foto:** compilam, mas o emulador de Storage deste ambiente não alcança o Firestore; o teste declara SKIP.

## Limitações conhecidas
- A foto de início exige **internet**.
- Aceitar exige a executora **preparada para a confirmação operacional** (`operationalCommandVersion` 1).
- O resumo do período da executora (tela inalterada por instrução) continua somando as viagens dela; só o **ranking de empresas** vai para a contratante.
- A carteira é derivada das parcerias; não há extrato bancário nem cobrança.
