# NVU PRO 1.0.550 (Android) / Web 2.3.207 / Windows 0.2.2

Base atual do projeto (branch `dist-build`). **Uma única base**: Web (`src/`), Android (`android/`, `versionCode` 550 — instala como atualização da 549, sem limpar dados), Windows (`desktop/windows/`, 0.2.2, carrega o mesmo web) e servidor (`functions/`, `firestore.rules`, `storage.rules`).

## O que mudou desde a 549 — Parcerias B2P (acordo entre empresas)

### Como funciona
1. **Contratante** (ex.: DC Transportes) abre **Central de gestão → Parcerias B2P → Propor operação** e escolhe a empresa parceira (mesmo simulador), o nome da operação, a quantidade de viagens, o veículo e o reboque exigidos, o prazo final, as *condições do acordo* (opcional, até 300 caracteres) e uma *meta de ganhos* (opcional, só acompanhamento).
2. **Executora** (ex.: CTS) recebe o convite e vê a oferta: **Aceitar** ou **Recusar**. Recusar encerra a oferta — nenhum trabalho é criado.
3. Ao aceitar, a executora **designa um motorista da própria equipe** (e o veículo/reboque que atendam à exigência). O motorista continua vinculado à executora.
4. O motorista vê a operação no painel normalmente, com o selo **Parceria**. Ao tocar em iniciar aparece o aviso *"Essa operação é um acordo entre empresas, conclua a operação dentro das especificações."* e **não é possível iniciar sem anexar a foto do veículo** (validado no servidor, não só na tela).
5. As viagens confirmadas contam **uma única vez**: no ranking de **empresas** somam para a **contratante**; a executora acompanha o andamento; o motorista mantém o histórico pessoal dele. O trabalho é um trabalho comum da executora (mesmas validações de viagem).
6. A conclusão independe da meta. Ao final, a página mostra os **resultados** (ganhos totais, % da meta, média, melhor viagem, gráfico e lista de viagens) e permite **repetir a operação** com a mesma empresa.
7. **Sem carteira, cobrança, pagamento, comissão ou reembolso** no NVU. A meta é só para acompanhar.

### Onde aparece
- **Central de gestão**: botão **Parcerias B2P** na lista (com selo "1 para responder" / "N em andamento") e a operação em **Trabalhos ativos** — para a contratante, a operação lida da parceria (somente leitura, com a faixa "Parceria · A contratou · B executa"); para a executora, o trabalho dela com o selo.
- **Página Parcerias B2P** (`/admin/parcerias`): "Propor operação" (rota DC ┈┈ +), "Enviar rápido para", abas Todas/Contratei/Executo, seções *Precisa da sua ação*, *Em andamento*, *Aguardando resposta* e *Concluídas*; oferta recebida, nova oferta, designar motorista, detalhe com livro de viagens e resultados.
- **Painel do motorista**: selo "Parceria" na fila e no cartão da operação, aviso e foto obrigatória no início.
- **Perfil da empresa: nada foi alterado** (instrução do pedido; há um teste que garante isso).

### Servidor (novo)
- Callables (também em São Paulo, como as demais ações): `createPartnershipOffer`, `respondPartnershipOffer`, `cancelPartnershipOffer`, `designatePartnershipDriver`. Gatilhos: `syncPartnershipFromJob`, `syncPartnershipTrips`.
- Coleção `partnerships` (leitura só pela gestão das duas empresas e pelo motorista designado; **nenhuma escrita do cliente**). Pasta de Storage `partnership-start-photos/{parceria}/{motorista}/…` (só o motorista designado envia, uma vez, imagem).
- A designação cria um contrato **oculto** (`pc_…`) da executora, fora de catálogos, filas automáticas e atribuição manual. `scoreCompanyId` nas viagens desvia **somente** o crédito do ranking de empresas; viagens comuns continuam creditadas à própria empresa, como antes.

## Verificação (o que foi e o que NÃO foi provado)
- `npm run qa` (gate completo) — novo passo `partnerships` (25 verificações de regras puras do servidor e do cliente, incluindo "cliente e servidor aplicam a mesma regra de exigência" e "perfil da empresa não foi tocado").
- Emulador (8 cenários, Firestore real + regras reais): oferta idempotente, permissões, recusa sem trabalho, cancelamento, designação (veículo/reboque/motorista de outra empresa recusados), início **bloqueado sem foto** e com foto de outro motorista/parceria, viagens contadas uma vez, atribuição do ranking e regras de leitura/escrita da coleção. Esse teste descobriu e corrigiu um erro real nas regras de *consulta* (list) da coleção.
- Telas conferidas em navegador (claro e escuro) com dados de exemplo; **não** foram vistas ainda com dados reais num aparelho.
- **Regras de Storage da foto**: compilam, mas o emulador de Storage deste ambiente não alcança o Firestore (limitação já conhecida das outras suítes de Storage), então a lógica "só o motorista designado envia" **não foi exercitada de ponta a ponta aqui** (o teste declara SKIP nesse caso).

## Limitações conhecidas
- **Nada foi publicado em produção.** Enquanto as funções novas e as regras (Firestore + Storage) não forem publicadas, a página abre vazia/sem permissão e o início de operação em parceria não funciona. Publicação só com autorização explícita.
- A foto de início exige **internet** (sobe para o Storage antes de iniciar).
- Aceitar uma oferta exige a executora **preparada para comandos operacionais** (`operationalCommandVersion` 1), como o restante do fluxo de designação.
- O resumo do período da própria executora (tela inalterada por instrução) continua somando as viagens dela como viagens da empresa; só o **ranking de empresas** vai para a contratante.
- O fluxo legado (`gtoTrips`) não foi alterado.
- O motorista consulta o resultado pelo fluxo de conclusão que já existia; o painel com "% da meta" e gráfico é das empresas.

O APK gerado pelo fluxo `APK Debug` é de **depuração**; o APK assinado de distribuição é gerado à parte, com a chave do projeto.
