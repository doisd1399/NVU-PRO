#!/usr/bin/env python3
"""Validate the delivered 504 inputs against its recorded source manifest.

This verifies local bytes only. It never changes a manifest or contacts Firebase.
"""
from pathlib import Path
import hashlib
import json

ROOT = Path(__file__).resolve().parents[1]
CONFIGS = [
    'package.json', 'package-lock.json', 'capacitor.config.ts', 'vite.config.ts',
    'NVU_RELEASE_METADATA.json', 'firestore.rules', 'storage.rules',
    'firestore.indexes.json', 'firebase.release-504.json',
    'functions/package.json', 'functions/package-lock.json', 'functions/tsconfig.json',
    'README_RELEASE_504.md', 'index.html', 'tsconfig.json', 'firebase.json', '.gitignore',
]
FOLDERS = ['src', 'public', 'functions/src', 'functions/lib', 'functions/scripts', 'scripts', 'android', 'tests']
SKIP_DIRS = {'node_modules', '.git', '.gradle', 'build', '__pycache__'}

def source_records():
    paths = {ROOT / name for name in CONFIGS}
    for folder in FOLDERS:
        for path in (ROOT / folder).rglob('*'):
            relative = path.relative_to(ROOT).as_posix()
            if not path.is_file() or SKIP_DIRS.intersection(path.parts):
                continue
            if relative.startswith('android/app/src/main/assets/') or path.name in {'local.properties', 'google-services.json'}:
                continue
            paths.add(path)
    return [{'path': path.relative_to(ROOT).as_posix(), 'bytes': path.stat().st_size,
             'sha256': hashlib.sha256(path.read_bytes()).hexdigest()}
            for path in sorted(paths)]

def source_digest(records):
    digest = hashlib.sha256()
    for row in records:
        digest.update(row['path'].encode() + b'\0' + row['sha256'].encode() + b'\0')
    return digest.hexdigest()

if __name__ == '__main__':
    manifest = json.loads((ROOT / 'reports/source-manifest-504.json').read_text())
    actual = source_records()
    if manifest.get('release') != '1.0.504' or actual != manifest['files'] or source_digest(actual) != manifest['sourceSetSha256']:
        raise SystemExit('SOURCE_504_FAIL: arquivos divergentes; não compile esta cópia como a fonte validada.')
    print(f"SOURCE_504_PASS {len(actual)} inputs {source_digest(actual)}")
