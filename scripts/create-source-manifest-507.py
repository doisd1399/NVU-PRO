from pathlib import Path
import hashlib,json

root=Path(__file__).resolve().parents[1]
previous=root/'reports/source-manifest-506.json'
baseline=json.loads(previous.read_text())
assert hashlib.sha256(previous.read_bytes()).hexdigest()=='693cb8c5304105124ce1d36e2f02677fe5c6ce7fd5c812dc813cebfd729faefd'
files={}
for f in sorted(root.rglob('*')):
 if not f.is_file():continue
 rel=f.relative_to(root);parts=rel.parts;name=str(rel)
 if any(k in parts for k in ['node_modules','.git','.gradle','.firebase','dist','reports','.vite']) or f.name.endswith('.log') or name.startswith(('functions/lib/','android/app/src/main/assets/','android/app/build/')):continue
 if not (parts[0] in ['src','functions','scripts','public','android'] or (len(parts)==1 and (f.name in ['package.json','package-lock.json','tsconfig.json','firestore.indexes.json','capacitor.config.ts','vite.config.ts','server.ts','.firebaserc'] or f.name.startswith('firebase') and f.suffix=='.json' or f.suffix=='.rules'))):continue
 files[name]=hashlib.sha256(f.read_bytes()).hexdigest()
manifest={'release':'1.0.507','webVersion':'2.3.185','baseline':'NVU-506-FONTE-CORRIGIDA.zip',
 'baselineZipSHA256':'4ffc418a5b7bd87799b07a64f99d0329016bb5f746944cdb70e98fd6288339ae',
 'previousSourceManifestSHA256':hashlib.sha256(previous.read_bytes()).hexdigest(),
 'changedSourceFiles':[name for name,sha in files.items() if baseline['files'].get(name)!=sha],
 'removedSourceFiles':sorted(set(baseline['files'])-set(files)),'files':files}
target=root/'reports/source-manifest-507.json';target.write_text(json.dumps(manifest,ensure_ascii=False,indent=2)+'\n')
print(json.dumps({'manifest':str(target),'files':len(files),'changed':len(manifest['changedSourceFiles']),'removed':manifest['removedSourceFiles']}))
