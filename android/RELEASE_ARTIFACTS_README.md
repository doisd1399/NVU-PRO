# Artefatos Release NVU 1.0.380

O APK `NVU-Operacional-1.0.380-release-original-signed.apk` foi compilado com `versionCode 380` e assinado pelo Gradle com a keystore original recuperada do Google Drive. O certificado corresponde ao aplicativo instalado: alias `nvukey`, keystore PKCS12 e certificado SHA-256 `80:6A:03:EA:92:B6:9E:7F:9A:70:52:6E:9C:4D:6A:4A:E5:2E:C4:F9:CF:7C:AC:05:DD:B1:AA:28:08:42:46:EA`.

O `google-services.json` original está integrado para o pacote `com.nvu.operacional`, restaurando a configuração nativa do Google Sign-In/Firebase. As credenciais da keystore estão registradas em `RELEASE_SIGNING_README.txt`; preserve o arquivo original para futuras atualizações.

A auditoria R2 unificou Print e Pro no mesmo mecanismo de finalização: `operationalCompletionCoordinator` e `TripsRepository.addTripWithinOperationLimit`. O Print agora envia `valorCents` explicitamente, e o guard transacional compara centavos de forma consistente. O bloqueio contra ganhos positivos consecutivos idênticos vale para ambos.

O modo Pro usa o áudio nativo original `res/raw/nvu_trip_completed_voice_pt_br.mp3`, reproduzido pelo `NvuAudioManager` somente após uma conclusão Pro elegível. O card persistente de confirmação também é exclusivo do modo Pro e contém origem, destino e ganhos, com fechamento por ícone ou arraste lateral; os menus flutuantes são ocultados enquanto o card estiver ativo. O modo Print não exibe card e não reproduz áudio.

Uma falha posterior na projeção local do Pro não transforma uma gravação remota já confirmada em erro de finalização; o Firestore é reconciliado como fonte autoritativa. O relatório completo está em `AUDITORIA_FLUXOS_PRINT_PRO_R2_2026-09-21.md`.
