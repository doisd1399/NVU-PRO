from pathlib import Path
import hashlib,json,sys
root=Path(__file__).resolve().parents[1]
manifest=root/'reports/source-manifest-505.json'
if not manifest.exists(): sys.exit('SOURCE_505_MANIFEST_MISSING')
data=json.loads(manifest.read_text())
failures=[]
for rel,expected in data['files'].items():
 p=root/rel
 if not p.is_file() or hashlib.sha256(p.read_bytes()).hexdigest()!=expected: failures.append(rel)
if failures:
 print(json.dumps({'status':'FAIL','files':failures},ensure_ascii=False));sys.exit(1)
print('SOURCE_505_PASS',len(data['files']),'source files; baseline',data['baselineZipSHA256'])
