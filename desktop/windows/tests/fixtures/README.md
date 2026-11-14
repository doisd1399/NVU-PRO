# NSIS CRC fixture

`nsis-crc.exe` is compiled from `nsis-crc.nsi` by NSIS 3.12, using the SHA-verified bundle 1.2.1 pinned by electron-builder 26.18.0. Tests read its bytes; they do not run the executable. Its section writes no files or registry values.

Recompile in this directory with the bundle's `makensis nsis-crc.nsi`. The tests corrupt this real compiled installer, including its PE stub while leaving compressed payload data unchanged, and require CRC rejection. They also reject truncation, appended data and disabled CRC. The verifier's unsigned NSIS scope is intentional; signed installers require validation of their certificate layout before broadening this policy.

Format references: https://github.com/kichik/nsis/blob/master/Source/exehead/fileform.c and https://github.com/kichik/nsis/blob/master/Source/exehead/fileform.h
