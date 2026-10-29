# Backend NVU — implantação de 27/10/2026

Projeto: vtc-frota-log. Fonte publicada: 4b65323c5913ad88689d1c54ecd146135e41bbf8.

Backup integral concluído antes das migrações: 21.226 documentos, 41.364.274 bytes exportados; 156 objetos verificados, incluindo metadados. Bucket privado, acesso público proibido e sem bindings públicos.

Foram processados 265 usuários em transações: 264 projeções públicas correspondem exatamente à função canônica publicUserProfile; um usuário excluído permanece sem projeção. Zero projeções ausentes, divergências ou campos extras. users não foi alterado.

Das 2.930 notificações, 19 datas foram convertidas a timestamp preservando o instante original e os demais campos. Todas as 2.930 estão com createdAt timestamp. Nenhuma data foi inventada.

Os dois índices de notifications estão READY. As seis funções estão ACTIVE, V1, Node 22, us-central1; syncUserPublicProfile e os dois gatilhos push possuem retry. Os gatilhos atualizados respondem a criação; a migração das datas não cria notificações. Não foi disparada mensagem de teste.

As ferramentas operacionais usaram REST por limitações de transporte do Admin SDK no ambiente. Reutilizaram a implementação compilada publicUserProfile e transações Firestore com releitura das fontes; as ferramentas executadas foram preservadas ao lado deste relatório.

ROLL-01 é resolvido somente quanto aos pré-requisitos de backend do novo cliente. As regras restritas não foram publicadas e dependem da adoção dos clientes novos. Novo APK, QA release/gate atual, entrega FCM física, jogo GTO e adoção dos usuários ainda não são comprovados por esta implantação.

Evidências: verification.json, migrations.json, backup-operation.json, backup-verification.json.

Validação posterior: QA Web/Firebase completo aprovado em 2026-10-27T12:15:50.350Z, 15 grupos, fonte inalterada. qa:self-test também passou. A primeira tentativa falhou por emulador ausente; após setup, a bateria completa foi repetida e aprovada. Este resultado não é aprovação de release Android.
