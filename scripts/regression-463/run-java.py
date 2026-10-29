from pathlib import Path
import subprocess,sys
root=Path(__file__).resolve().parents[2]
here=Path(__file__).resolve().parent
java=root/'android/app/src/main/java/com/nvu/operacional'
sources=list((root/'scripts/fixtures/pro-rejection').rglob('*.java'))
sources.extend(java/(n+'.java') for n in ['CompletedOperationScope', 'ProPendingTripStore', 'CanonicalTripOutboxSchema', 'PendingTripFailurePolicy', 'GtoResultCompletionPolicy', 'GtoResultOcrConsensusPolicy', 'GtoProReceiptValidationPolicy', 'GtoBackendCompatibilityPolicy'])
sources.extend([here/'PendingIndexAudit.java',here/'RetryClassificationAudit.java'])
classes=here/'java-classes';classes.mkdir(exist_ok=True)
subprocess.run(['javac','-encoding','UTF-8','-d',str(classes), *map(str,sources)],check=True)
for name in ['RetryClassificationAudit','PendingIndexAudit','ProRejectionHarness','GtoRecoveryMultiOwnerHarness']:
 p=subprocess.run(['java','-cp',str(classes),'com.nvu.operacional.'+name],capture_output=True,text=True)
 print(name,'PASS' if p.returncode==0 else 'FAIL',p.stdout[-3000:],p.stderr[-3000:])
 if p.returncode: sys.exit(p.returncode)
