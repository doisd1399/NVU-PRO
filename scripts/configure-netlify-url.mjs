import fs from 'node:fs';
import path from 'node:path';

const destination = path.resolve(process.cwd(), 'capacitor.remote.json');
const argument = process.argv[2]?.trim();

if (argument === '--local' || !argument) {
  fs.writeFileSync(
    destination,
    `${JSON.stringify({
      enabled: false,
      url: '',
      usage: 'Legacy configuration retained for history only. Production Android uses bundled local Web assets; do not configure server.url.',
    }, null, 2)}\n`,
    'utf8',
  );
  console.log('Modo local-first confirmado: o APK usa os arquivos Web empacotados em dist.');
  process.exit(0);
}

console.error('Runtime remoto do APK está bloqueado por política local-first.');
console.error('O Netlify continua disponível para o site Web e para bundles OTA assinados, não como server.url do APK.');
console.error('Use `npm run cap:configure-netlify -- --local` para confirmar o modo local.');
process.exit(1);
