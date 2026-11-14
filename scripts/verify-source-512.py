from pathlib import Path
import hashlib
import json
import sys

root = Path(__file__).resolve().parents[1]
manifest = root / 'reports/source-manifest-512.json'
if not manifest.exists():
    sys.exit('SOURCE_512_MANIFEST_MISSING')
data = json.loads(manifest.read_text())
if data.get('release') != '1.0.512' or data.get('webVersion') != '2.3.189':
    sys.exit('SOURCE_512_VERSION_MISMATCH')
actual = {}
for f in sorted(root.rglob('*')):
    if not f.is_file():
        continue
    rel = f.relative_to(root)
    parts = rel.parts
    name = str(rel)
    if name == 'android/app/google-services.json' or any(k in parts for k in ['node_modules', '.git', '.gradle', '.firebase', 'dist', 'dist-apk', 'build', 'reports', '.vite']) or f.name.endswith('.log') or name.startswith(('functions/lib/', 'android/app/src/main/assets/')):
        continue
    if not (parts[0] in ['src', 'functions', 'scripts', 'public', 'android'] or (len(parts) == 1 and (f.name in ['package.json', 'package-lock.json', 'NVU_RELEASE_METADATA.json', 'tsconfig.json', 'firestore.indexes.json', 'capacitor.config.ts', 'vite.config.ts', 'server.ts', '.firebaserc'] or f.name.startswith('firebase') and f.suffix == '.json' or f.suffix == '.rules'))):
        continue
    actual[name] = hashlib.sha256(f.read_bytes()).hexdigest()
failed = sorted(name for name in set(data['files']) | set(actual) if data['files'].get(name) != actual.get(name))
if failed:
    print(json.dumps({'status': 'FAIL', 'files': failed}, ensure_ascii=False))
    sys.exit(1)
print('SOURCE_512_PASS', len(actual), 'source/config files; baseline manifest', data['baselineManifestSHA256'])
