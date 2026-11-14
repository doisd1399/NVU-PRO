from pathlib import Path
import argparse
import hashlib
import json

root = Path(__file__).resolve().parents[1]
parser = argparse.ArgumentParser()
parser.add_argument('--baseline', default='reports/source-manifest-512.json')
args = parser.parse_args()
previous = root / args.baseline
baseline = json.loads(previous.read_text())
files = {}
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
    files[name] = hashlib.sha256(f.read_bytes()).hexdigest()
previous_hash = hashlib.sha256(previous.read_bytes()).hexdigest()
manifest = {
    'release': '1.0.513',
    'webVersion': '2.3.190',
    'baseline': previous.relative_to(root).as_posix(),
    'baselineManifestSHA256': previous_hash,
    'previousSourceManifestSHA256': previous_hash,
    'changedSourceFiles': [name for name, sha in files.items() if baseline['files'].get(name) != sha],
    'removedSourceFiles': sorted(set(baseline['files']) - set(files)),
    'files': files,
}
target = root / 'reports/source-manifest-513.json'
target.write_text(json.dumps(manifest, ensure_ascii=False, indent=2) + '\n')
print(json.dumps({'manifest': str(target), 'files': len(files), 'changed': len(manifest['changedSourceFiles']), 'removed': manifest['removedSourceFiles']}, ensure_ascii=False))
