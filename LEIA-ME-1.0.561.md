# NVU PRO 1.0.561 (Android) / Web 2.3.218 / Windows 0.2.2

Base atual do projeto (branch `dist-build`). **Uma única base**: Web (`src/`), Android (`android/`, `versionCode` 561 — instala como atualização da 560/559/558/557/556/555/554/553/552/551/550, sem limpar dados), Windows (`desktop/windows/`, 0.2.2, carrega o mesmo web) e servidor (`functions/`, `firestore.rules`, `storage.rules`).

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
