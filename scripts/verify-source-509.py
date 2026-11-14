from pathlib import Path
import hashlib,json,sys
root=Path(__file__).resolve().parents[1]
manifest=root/'reports/source-manifest-509.json'
if not manifest.exists(): sys.exit('SOURCE_509_MANIFEST_MISSING')
data=json.loads(manifest.read_text()); actual={}
for f in sorted(root.rglob('*')):
 if not f.is_file(): continue
 rel=f.relative_to(root); parts=rel.parts; name=str(rel)
 if any(k in parts for k in ['node_modules','.git','.gradle','.firebase','dist','reports','.vite']) or f.name.endswith('.log') or name.startswith(('functions/lib/','android/app/src/main/assets/','android/app/build/')): continue
 if not (parts[0] in ['src','functions','scripts','public','android'] or (len(parts)==1 and (f.name in ['package.json','package-lock.json','tsconfig.json','firestore.indexes.json','capacitor.config.ts','vite.config.ts','server.ts','.firebaserc'] or f.name.startswith('firebase') and f.suffix=='.json' or f.suffix=='.rules'))): continue
 actual[name]=hashlib.sha256(f.read_bytes()).hexdigest()
failed=sorted(name for name in set(data['files'])|set(actual) if data['files'].get(name)!=actual.get(name))
if failed: print(json.dumps({'status':'FAIL','files':failed},ensure_ascii=False));sys.exit(1)
print('SOURCE_509_PASS',len(actual),'source/config files; baseline',data['baselineZipSHA256'])
