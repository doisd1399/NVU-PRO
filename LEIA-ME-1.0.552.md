# NVU PRO 1.0.552 (Android) / Web 2.3.209 / Windows 0.2.2

Base atual do projeto (branch `dist-build`). **Uma única base**: Web (`src/`), Android (`android/`, `versionCode` 552 — instala como atualização da 551/550, sem limpar dados), Windows (`desktop/windows/`, 0.2.2, carrega o mesmo web) e servidor (`functions/`, `firestore.rules`, `storage.rules`).

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

### 5. Parceiras ativas do mesmo simulador
A lista vem do **catálogo público** de empresas (antes lia só as empresas do usuário): ativas, não arquivadas/suspensas, do mesmo simulador (identidade canônica, GTO = Global Truck Online etc.). O servidor repete as regras ao enviar.

### Publicação
Funções novas/alteradas das Parcerias: `createPartnershipOffer`, `respondPartnershipOffer`, `cancelPartnershipOffer`, `designatePartnershipDriver`, **`settlePartnershipPayment` (nova)** e gatilhos `syncPartnershipFromJob`, `syncPartnershipTrips`; regras de Firestore e Storage. Também foram alteradas funções **já existentes em produção** (`operationalCommand`, `registerCanonicalSimpleTrip`, `registerGtoProReceipt`, funções de ranking, filas operacionais): a publicação delas é **uma decisão à parte**.

## Verificação (o que foi e o que NÃO foi provado)
- `npm run qa` (gate completo). Passo `partnerships`: 47 verificações (oferta com prazo em dias e valor, paridade da liquidação servidor × app, passos de pagamento, carteira, lista de parceiras, guardas de "sem veículo na oferta").
- Emulador, 13 cenários, incluindo liquidação pelo gatilho `syncPartnershipFromJob`.
- Telas conferidas no navegador (claro e escuro) com dados de exemplo e fluxos executados (enviar oferta com valor, aceitar, designar, marcar como pago) com o payload dos serviços verificado. **Não** vistas com dados reais num aparelho.
- **Regras de Storage da foto:** compilam, mas o emulador de Storage deste ambiente não alcança o Firestore; o teste declara SKIP.

## Limitações conhecidas
- A foto de início exige **internet**.
- Aceitar exige a executora **preparada para a confirmação operacional** (`operationalCommandVersion` 1).
- O resumo do período da executora (tela inalterada por instrução) continua somando as viagens dela; só o **ranking de empresas** vai para a contratante.
- A carteira é derivada das parcerias; não há extrato bancário nem cobrança.
