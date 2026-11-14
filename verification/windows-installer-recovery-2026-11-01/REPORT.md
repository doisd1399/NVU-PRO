# NVU Windows — falha de integridade NSIS relatada

A captura mostra falha de integridade do instalador. Ela não identifica o tamanho ou hash do arquivo que falhou. A cópia do PC ainda não foi recebida.

A cópia gerada e a cópia recuperada do arquivo efetivamente disponibilizado foram comparadas: ambas têm 125712878 bytes, SHA-256 2e1b315677f726222ec8a8d2fdd4b5b40deb92b52b62081a038951b3458994a3 e CRC nativo NSIS 8717188d. O cabeçalho NSIS está na posição 51712 e o tamanho declarado termina exatamente no fim do EXE. A extração por arquivador já tinha sido validada na etapa anterior; agora também foi conferida a verificação nativa, que abrange o stub.

A origem do erro no PC continua sem confirmação. Não foi atribuída a causa ao download, ao antivírus ou ao sistema sem comparar o arquivo que falhou. Não se removeu o CRC nem se usou bypass de integridade.

## Mudanças

- O build bloqueia uma entrega com cabeçalho inválido, CRC desligado, comprimento divergente ou CRC incorreto. A implementação segue a estrutura e o cálculo normais do NSIS 3 para executáveis sem assinatura.
- Um instalador pequeno real foi compilado com NSIS 3.12 e incluído como fixture de leitura. Testes rejeitam corrupção no stub, dados ou CRC, truncamento, bytes extras e CRC desligado. Outro teste verifica a sintaxe dos scripts de empacotamento.
- Novo comando `npm run windows:portable` gera o aplicativo completo em ZIP. Havendo instalador já compilado, também gera um ZIP com NVU-Setup.exe, instruções e checksum.
- As duas alternativas mantêm o aplicativo 0.1.1 e sua configuração OAuth. A versão sem instalação usa os mesmos dados de usuário em %APPDATA%\NVU PRO. O EXE original foi preservado; ele não foi alterado para aparentar corrigir uma causa desconhecida.

## Evidências de qualidade

Os 18 testes Windows controlados passaram. Uma execução completa foi bloqueada porque a fonte mudou durante a validação; ela foi preservada em qa-source-changed e não foi usada para aprovar a entrega. Uma tentativa inicial encontrou um lock de uma execução já concluída; os processos foram conferidos antes de remover o lock antigo. A aprovação final exige outra execução completa com a fonte estável.

## Uso das alternativas

Extraia todo o Portable.zip para uma pasta do seu usuário e abra NVU PRO.exe dentro da pasta extraída, preservando resources e os demais arquivos. Para tentar a instalação, extraia todo o Instalador.zip e abra NVU-Setup.exe. Se ele ainda exibir o alerta, envie o EXE efetivamente baixado ou seu SHA-256 para comparação.

Os ZIPs e o arquivo original continuam sem assinatura digital. Extração, checksums e testes controlados não substituem executar a nova entrega em Windows, fazer login Google e concluir viagens nos jogos. O incidente no dispositivo não foi marcado como resolvido sem confirmação.

Referências oficiais: https://nsis.sourceforge.io/Why_do_I_get_NSIS_Error e https://github.com/kichik/nsis/blob/master/Source/exehead/fileform.c


## Resultado final desta execução

QA completo: 18/18 etapas aprovadas, fonte estável durante a execução; 18 testes Windows controlados aprovados. O empacotamento inicialmente recusou um nvu-build.json antigo; a aplicação foi reempacotada com o build Web atual antes de gerar os ZIPs. Ambos os ZIPs passaram na extração e verificação de CRC. 224 arquivos do programa portátil foram comparados byte a byte com a aplicação empacotada; o EXE dentro do ZIP do instalador tem exatamente o SHA-256 original. As configurações e o runtime da aplicação 0.1.1 foram preservados. A confirmação no dispositivo continua pendente.
