from pathlib import Path
import hashlib,json

root=Path(__file__).resolve().parents[1]
previous=root/'reports/source-manifest-507.json'
baseline=json.loads(previous.read_text())
assert hashlib.sha256(previous.read_bytes()).hexdigest()=='a04784b4662b2770fcd56aafa95bf87d48555b04cf4393d656d107e200440886'
files={}
for f in sorted(root.rglob('*')):
 if not f.is_file():continue
 rel=f.relative_to(root);parts=rel.parts;name=str(rel)
 if any(k in parts for k in ['node_modules','.git','.gradle','.firebase','dist','reports','.vite']) or f.name.endswith('.log') or name.startswith(('functions/lib/','android/app/src/main/assets/','android/app/build/')):continue
 if not (parts[0] in ['src','functions','scripts','public','android'] or (len(parts)==1 and (f.name in ['package.json','package-lock.json','tsconfig.json','firestore.indexes.json','capacitor.config.ts','vite.config.ts','server.ts','.firebaserc'] or f.name.startswith('firebase') and f.suffix=='.json' or f.suffix=='.rules'))):continue
 files[name]=hashlib.sha256(f.read_bytes()).hexdigest()
manifest={'release':'1.0.508','webVersion':'2.3.186','baseline':'NVU-507-FONTE-CORRIGIDA.zip',
 'baselineZipSHA256':'de9c0154b46913de4f0f7240763e6f763a775e7ca483cf55ef44e896a1a39492',
 'previousSourceManifestSHA256':hashlib.sha256(previous.read_bytes()).hexdigest(),
 'changedSourceFiles':[name for name,sha in files.items() if baseline['files'].get(name)!=sha],
 'removedSourceFiles':sorted(set(baseline['files'])-set(files)),'files':files}
target=root/'reports/source-manifest-508.json';target.write_text(json.dumps(manifest,ensure_ascii=False,indent=2)+'\n')
print(json.dumps({'manifest':str(target),'files':len(files),'changed':len(manifest['changedSourceFiles']),'removed':manifest['removedSourceFiles']}))
