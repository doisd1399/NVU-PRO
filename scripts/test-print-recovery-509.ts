import assert from 'node:assert/strict';
import { isEligiblePrintProtocolReplay, pendingTripFailureExplanation } from '../src/lib/printProtocolRecovery509';
import { failedRegistrationRecoveryReason } from '../src/lib/failedTripRegistrationRecovery';

const trip: Record<string, any> = {
  gtoEntryMode:'print', gtoReceiptAnalyzed:true, gtoRewardedAdDetected:false,
  imageHash:'sha256-original', offlineReceiptKey:'stored-receipt', valor:38450,
  valorCents:3845000, receiptText:'Concluído Valor a receber R$ 38.450,00',
  canonicalTripId:'t509',tripId:'t509',idempotencyKey:'t509',jobId:'job',
  companyId:'company',contractId:'contract',driverId:'driver',syncVersion:1
};
const schemaError='functions/invalid-argument: REQUEST_INVALID: Campo não permitido: gtoReceiptEvidence.';
const ocrError='functions/invalid-argument: REQUEST_INVALID: GTO_RECEIPT_AMOUNT_OR_BONUS_INVALID';
assert(isEligiblePrintProtocolReplay(trip,schemaError));
assert(isEligiblePrintProtocolReplay(trip,ocrError));
assert(!isEligiblePrintProtocolReplay(trip,'functions/invalid-argument: REQUEST_INVALID: Rota inválida.'));
assert(!isEligiblePrintProtocolReplay({...trip,valorCents:3845001},schemaError));
assert(!isEligiblePrintProtocolReplay({...trip,valor:2341},schemaError));
assert(!isEligiblePrintProtocolReplay({...trip,receiptText:trip.receiptText+' Valor dobrado'},ocrError));
assert(!isEligiblePrintProtocolReplay({...trip,gtoRewardedAdDetected:true},ocrError));
assert(!isEligiblePrintProtocolReplay({...trip,offlineReceiptKey:''},schemaError));
assert(!isEligiblePrintProtocolReplay({...trip,gtoEntryMode:'pro'},schemaError));
assert(!isEligiblePrintProtocolReplay(trip,'functions/permission-denied: Campo não permitido: gtoReceiptEvidence.'));
assert.match(pendingTripFailureExplanation(schemaError),/endpoint publicado/);
const command:any={trip,state:'FAILED',operation:'UPSERT',lastError:schemaError,lastFailureStage:'CALLABLE_REGISTRATION'};
const record:any={trip:{...trip},syncStatus:'CONFLICT',syncVersion:1};
const reason=(cmd=command,rec=record,uid='driver')=>failedRegistrationRecoveryReason('t509',cmd,rec,{t509:cmd},uid,'company');
assert.equal(reason(),'PRINT_PROTOCOL_RETRY');
assert.equal(reason({...command,manualHistoryRecoveryAttempt:true}),'FAILURE_REQUIRES_REVIEW');
assert.equal(reason({...command,lastFailureStage:'RECEIPT_UPLOAD'}),'FAILURE_REQUIRES_REVIEW');
assert.equal(reason(command,record,'other'),'OTHER_ACCOUNT');
assert.equal(reason({...command,trip:{...trip,valor:2341}}),'FAILURE_REQUIRES_REVIEW');
assert.equal(reason(command,{...record,trip:{...trip,valor:2341}}),'PAYLOAD_REQUIRES_REVIEW');
assert.equal(reason({...command,trip:{...trip,deleted:true}}),'IDENTITY_REQUIRES_REVIEW');
console.log('PRINT_RECOVERY_509_PASS 18');
