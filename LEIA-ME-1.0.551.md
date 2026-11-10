# NVU PRO 1.0.551 (Android) / Web 2.3.208 / Windows 0.2.2

Base atual do projeto (branch `dist-build`). **Uma única base**: Web (`src/`), Android (`android/`, `versionCode` 551 — instala como atualização da 550, sem limpar dados), Windows (`desktop/windows/`, 0.2.2, carrega o mesmo web) e servidor (`functions/`, `firestore.rules`, `storage.rules`).

## O que mudou desde a 550 — Parcerias B2P: ajustes pedidos

### 1. Empresas parceiras: todas as ATIVAS do mesmo simulador
**Causa do problema:** o seletor da v44 lia `companies` (as empresas do próprio usuário), não o catálogo público de todas as empresas do sistema. Para um gestor comum a lista saía vazia ou só com a própria empresa.
**Correção:**
- A página carrega o **catálogo público** (`allCompanies`, o mesmo da tela "Empresas") e monta a lista em `src/lib/partnerCandidates.ts`.
- Entram só empresas **ativas** (não excluídas, não arquivadas/suspensas/inativas — inclui frota de simulador desativado) e do **mesmo simulador da empresa logada**, comparado pela identidade canônica (GTO = Global Truck Online etc.), como o resto do app. A própria empresa nunca aparece.
- Ordem: já parceiras primeiro (mais recente antes), depois alfabética. Estados claros: carregando, falha com "Tentar de novo", simulador não identificado e "nenhuma outra empresa ativa no simulador".
- O **servidor repete as regras** ao enviar a oferta: parceira inexistente, arquivada/excluída/inativa/suspensa ou de outro simulador é recusada com mensagem clara.
- Se a parceira ainda não preparou a confirmação operacional da empresa, a oferta é enviada mesmo assim, a contratante é **avisada** e a parceira recebe, ao tentar aceitar, a orientação de onde preparar (Operações).

### 2. O veículo é escolhido pela empresa que vai operar
- A **oferta** passou a definir só: **reboque** (opcional), **prazo**, **quantidade de viagens**, **meta** e **condições do acordo**. Não existe mais "veículo exigido" (nem no formulário, nem na oferta, nem no servidor).
- Ao aceitar, a executora escolhe o **motorista** da própria equipe, **qualquer veículo da própria frota** e — se a oferta exigir — o reboque compatível (sem exigência, o reboque é opcional e também da própria frota). O servidor continua recusando veículo/reboque de outra empresa e reboque que não atende à exigência.
- Apps antigos (1.0.550) que ainda enviem o campo de veículo continuam funcionando: o campo é ignorado.

### 3. Listas de opções iguais às da Central de gestão
- Nova janela **`AssignmentOptionPicker`** com o mesmo desenho das listas da Central (tela cheia, busca, cartões com avatar, descrição e botão de rádio, rodapé Cancelar/Usar): empresa parceira (com logo e selo "Já parceira"), reboque (frota, "Sem exigência" e nome digitado) e reboque na designação (selo "Compatível"; os que não atendem aparecem bloqueados com o motivo).
- **Veículo na designação:** a própria janela "Escolher veículo" da Central (com pastas e "Em uso por N motoristas").
- **Motorista na designação:** lista com foto, nome e situação ("Disponível" / "Tem N trabalhos abertos") e busca quando a equipe é grande.
- Cartões e ofertas deixam de mostrar veículo exigido; mostram viagens, prazo, reboque (se houver) e meta.

### Publicação
Este pacote inclui as **funções** (`createPartnershipOffer`, `respondPartnershipOffer`, `cancelPartnershipOffer`, `designatePartnershipDriver` em São Paulo e Iowa; gatilhos `syncPartnershipFromJob` e `syncPartnershipTrips`) e as **regras** (Firestore e Storage) das Parcerias. Veja o relatório da entrega para o estado real da publicação.

## Verificação (o que foi e o que NÃO foi provado)
- `npm run qa` (gate completo, incluindo emulador). Passo `partnerships`: **33 verificações** (oferta sem veículo, lista de parceiras ativas/mesmo simulador com alias, "a página lê o catálogo público", exigência de reboque igual no app e no servidor, perfil da empresa não tocado).
- Emulador, **11 cenários**: oferta idempotente e permissões; parceira arquivada/excluída/inativa/suspensa/outro simulador recusada; mesmo simulador por outro nome aceito; aceite sem preparo operacional com orientação; designação com **qualquer veículo da própria frota**; reboque exigido conferido; início **bloqueado sem foto**; viagens contadas uma vez; ranking credita a contratante; regras de leitura/escrita.
- Telas conferidas no navegador (claro e escuro) com dados de exemplo e **fluxos executados** (escolher parceira na lista, digitar reboque, designar motorista/veículo/reboque) com o payload dos serviços verificado. **Não** vistas com dados reais num aparelho.
- **Regras de Storage da foto:** compilam, mas o emulador de Storage deste ambiente não alcança o Firestore; o trecho "só o motorista designado envia" não é exercitado de ponta a ponta aqui (o teste declara SKIP).

## Limitações conhecidas
- A foto de início exige **internet**.
- Aceitar exige a executora **preparada para a confirmação operacional** (`operationalCommandVersion` 1); a oferta pode ser enviada antes, mas só é aceita depois do preparo.
- O resumo do período da executora (tela inalterada por instrução) continua somando as viagens dela como da empresa; só o **ranking de empresas** vai para a contratante.
- O fluxo legado (`gtoTrips`) não foi alterado.

O APK gerado pelo fluxo `APK Debug` é de **depuração**; o APK assinado de distribuição é gerado à parte, com a chave do projeto.
