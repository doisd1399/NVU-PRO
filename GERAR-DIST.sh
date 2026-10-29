#!/usr/bin/env bash
# Gera o dist para publicação manual (Netlify). Requer Node 20+ e acesso ao registro do npm.
set -euo pipefail
cd "$(dirname "$0")"
npm ci
npm run lint
npm run build
rm -f NVU-PRO-2.3.198-dist.zip
(cd dist && zip -qr ../NVU-PRO-2.3.198-dist.zip .)
echo "Pronto: NVU-PRO-2.3.198-dist.zip"
