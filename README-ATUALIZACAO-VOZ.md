# NVU PRO 1.0.596 — Assistente de Voz v2

Catálogo atual: 49 frases em duas vozes, totalizando 98 MP3.
Masculina: pt-BR-AntonioNeural, 1,24×. Feminina: pt-BR-FranciscaNeural, 1,12×.
12 MP3 aprovados foram preservados; 86 foram gerados na execução anterior.

Os áudios são locais, sem síntese remota durante o uso. Os menus flutuante e lateral compartilham ativação, voz, volume, frequência e prévia. A narração automática de páginas foi desativada. As saudações respeitam horário, perfil e situação atual. Eventos financeiros e viagens confirmadas observam as respostas reais existentes.

O canal usa intervalo, fila limitada, expiração, preferências e isolamento por conta/empresa/simulador. Há cache para uso Web offline após preparação e arquivos empacotados no Android. O Windows observa o diário nativo sem confundir detecção/aceitação local com confirmação do servidor.

O manifesto em public/audio/nvu/manifest.json contém duração, tamanho e SHA-256 de cada MP3 do catálogo v2. Os 38 áudios legados permanecem no projeto para compatibilidade, fora do catálogo atual e do pacote de 98 MP3.

Validação atual e limitações: consulte qa/results/latest.html após executar npm run qa ou qa:release. Relatórios antigos não aprovam esta fonte. A geração do APK exige qa:release, qa:gate, Android instrumental e a chave original. O workflow da branch de release preserva os resultados e só assina após aprovação completa.

Os testes controlados de áudio e cache não comprovam reprodução em aparelho nem integração real com GTO/ETS2/ATS.
