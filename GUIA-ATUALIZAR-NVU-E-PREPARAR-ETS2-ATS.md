# Guia curto — atualizar a NVU e preparar o ETS2/ATS (versão 0.2.2)

> Esta é a edição **candidata 0.2.2**. Foi testada no Windows real (instalação, atualização, instância única, desinstalação), mas **ainda não foi assinada digitalmente nem testada com o ETS2/ATS reais** (veja o relatório). O Windows vai mostrar "editor desconhecido" — **não desative o SmartScreen nem o antivírus**; confira o arquivo (passo 1) e siga o passo 2.

## 1. Conferir o arquivo (30 segundos)
Deixe `NVU-PRO-Setup-0.2.2-x64.exe`, `release-manifest.json` e `Verificar-NVU.ps1` na mesma pasta. Clique com o botão direito em `Verificar-NVU.ps1` → **Executar com o PowerShell**. A janela mostra tamanho, SHA-256 e a situação da assinatura e espera Enter para fechar. Deve aparecer **OK: tamanho e SHA-256 conferem**. Se aparecer FALHA, o download está incompleto ou foi alterado: baixe de novo (e me envie o tamanho e o SHA-256 mostrados).

## 2. Instalar ou atualizar
1. Feche os jogos. Se a NVU antiga estiver aberta, o instalador avisa e oferece fechá-la (suas viagens pendentes ficam salvas).
2. Execute `NVU-PRO-Setup-0.2.2-x64.exe` e siga o assistente. Não precisa ser administrador. A atualização mantém configurações, fotos locais e viagens pendentes. Se aparecer a tela azul **"O Windows protegeu o computador"** (esperado enquanto o instalador não é assinado), clique em **Mais informações → Executar assim mesmo**, só depois de o passo 1 mostrar OK. Computador de empresa pode bloquear de vez: fale com o TI; não desative a proteção.
3. Abra pelo atalho **NVU PRO** (Menu Iniciar ou Área de Trabalho). **Não abra a NVU de uma pasta de downloads antiga.**
4. Versões futuras: a NVU instalada confere sozinha (no máximo a cada 12 horas) se há versão nova publicada e, se houver, mostra **"Nova versão … disponível"** no topo da aba Viagem e no ícone da bandeja. Ela **só avisa** — não baixa nem instala nada; **Ver novidades** abre a página oficial, de onde você baixa e repete os passos 1 e 2. É uma consulta anônima ao GitHub (ele vê o seu IP, como em qualquer download). Para desligar, defina a variável de ambiente `NVU_NO_UPDATE_CHECK=1`.

## 3. Entrar
Entre com a mesma conta Google da NVU. Se aparecer "sessão expirada", entre de novo; se aparecer "sem conexão com o Google", a sessão salva continua e a NVU tenta de novo sozinha.

## 4. Preparar o simulador (uma vez por jogo)
1. Feche o ETS2/ATS.
2. Na NVU: **PRO → Simuladores → Preparar simulador**. Se o jogo não aparecer, use **Localizar jogo** e escolha a pasta que contém `bin\win_x64`.
3. Se o Windows pedir permissão de administrador, é só para copiar o arquivo do plugin para a pasta do jogo; aceite. A NVU e o jogo continuam normais.
4. Abra o jogo e aceite o aviso de plugin da SCS, se aparecer. Na NVU as etapas ficam verdes: *Jogo localizado → Plugin instalado → Carregado pelo jogo → Conectado*.

Cada simulador mostra três versões: **Esperada** (a desta NVU), **Instalada** (arquivo na pasta do jogo) e **Carregada pelo jogo**. Arquivo instalado não é plugin carregado: se a carregada for diferente da esperada, feche e abra o jogo.

## 5. Usar
Selecione a operação, **Ativar PRO** e jogue. **Ctrl+N** abre/oculta o assistente; todas as ações são pelo mouse. O progresso só muda quando o servidor confirma a viagem.

## Sem internet
A NVU **abre sem internet** e mantém você entrado. Aparecem o perfil, as fotos que você já viu com internet (veículo, capa, ranking) e os dados que a tela já tinha guardado. **Listas e dados novos precisam de internet** (ranking atualizado, histórico completo, aprovações, trocar de empresa). As entregas do jogo continuam sendo salvas no computador e são enviadas sozinhas quando a internet volta; a finalização da operação só se confirma depois disso. Na primeira vez após instalar, abra com internet para a NVU guardar o que precisa.

## 6. Se algo falhar
A tela mostra um **código** (por exemplo `NVU-S041`) e o que fazer. Em **PRO → Simuladores → Ajuda com a conexão e diagnóstico** use **Diagnóstico de inicialização** (copia um texto sem dados pessoais) ou **Abrir registros**. Não apague `%APPDATA%\NVU PRO`: nela ficam as viagens pendentes.
