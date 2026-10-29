# Integração completa do Modo Print seguro — R12

O projeto principal deste pacote é o projeto original baixado do Google Drive. Foi substituído somente o chunk da página `RecordTrip` pelo componente completo da versão segura do GitHub, com seus imports compartilhados mapeados para os bundles atuais do projeto Drive. O restante da aplicação Android, Firebase, Capacitor, módulos nativos e assets permanece do projeto Drive.

A implementação segura recupera a página completa de lançamentos e seu fluxo de leitura: captura de snapshot do arquivo Android, OCR assíncrono, promoção do valor identificado antes da decisão de evidência de anúncio/dobro, estados de leitura, validação de duplicidade, upload e bloqueio conservador de lançamento.

O versionCode foi atualizado para 378 para permitir a instalação do APK corrigido.
