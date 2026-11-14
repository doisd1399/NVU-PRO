# NVU — assistente de voz aprovado

Atualizado em 13/11/2026 sobre o projeto enviado 1.0.595. Candidato: Android 1.0.596 / Web 2.3.253.

## Vozes e acesso

As duas vozes estilo GPS aprovadas foram incorporadas: masculina e feminina em português brasileiro. O menu flutuante e o menu lateral compartilham os controles: ativar/silenciar, voz, volume, frequência Completo/Discreto e Ouvir exemplo. As preferências ficam salvas por usuário neste dispositivo.

São 27 frases por voz, totalizando 54 MP3, de 1,86 a 4,60 segundos. A reprodução usa arquivos locais; não precisa contratar um serviço de síntese para cada uso. Os exemplos aprovados da central foram preservados.

## Saudações

Uma saudação por papel na sessão, com rodízio das cinco antes de repetir. A reabertura rápida não reinicia a saudação; 30 minutos sem atividade inicia uma sessão nova.

| Papel | Fala |
| --- | --- |
| Motorista | Bem-vindo de volta. Vamos à próxima viagem. |
| Motorista | Bom ter você por aqui. Vamos seguir viagem. |
| Motorista | Ao seu lado, em cada viagem. Podemos começar. |
| Motorista | Bem-vindo. Vamos conferir seu próximo trabalho. |
| Motorista | A próxima etapa começa aqui. Vamos em frente. |
| Administrador | Bem-vindo de volta. A central de gestão está à sua disposição. |
| Administrador | Bom ter você por aqui. Vamos acompanhar sua empresa. |
| Administrador | Bem-vindo. Vamos conferir o andamento da operação. |
| Administrador | À sua disposição. Vamos organizar os próximos passos. |
| Administrador | Bem-vindo à central. Vamos cuidar da sua operação. |

## Áreas e confirmações

O modo Completo contextualiza algumas áreas; Discreto mantém saudações e confirmações importantes. Navegação aguarda 900 ms, fala no máximo uma vez por área/sessão, respeita um minuto entre áreas e três falas de navegação em dez minutos. Telas paradas não geram falas periódicas.

Início e finalização dependem de confirmação do servidor. Viagem registrada depende de um evento canônico novo e confirmado, da conta e empresa ativas. Notificações antigas apenas hidratam o sino. As falas nativas do PRO Android usam a voz escolhida e o mesmo canal. Detecção do término informa “Preparando o registro”; não equivale a confirmação de registro.

## Um áudio por vez

- Uma fala ativa e, no máximo, uma confirmação aguardando.
- Intervalo mínimo de oito segundos entre falas automáticas.
- Avisos podem substituir apenas o item que aguarda, conforme prioridade.
- A troca de voz vale para a próxima frase e preserva a atual.
- Intenções antigas ou de outro contexto são descartadas.
- Silenciar e sair da conta cancelam explicitamente o som.
- O exemplo manual usa o mesmo canal e aguarda que esteja livre.
- Falha de áudio não bloqueia telas ou viagens.

## Conteúdo entregue

O projeto inclui o catálogo de textos, 54 MP3, manifesto de duração/tamanho/SHA-256, controles compartilhados, fila central e integração nativa Android. O áudio de falha está disponível no catálogo, reservado para um evento definitivo; não foi conectado a erros genéricos ou tentativas offline.

Detalhes e limites de validação estão em `docs/ASSISTENTE-DE-VOZ-596.md` e no relatório de qualidade incluído no projeto. A entrega é de código e dist; publicação e novo APK exigem seu fluxo próprio de liberação e validação em aparelho.
