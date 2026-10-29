import fs from 'node:fs';
import assert from 'node:assert/strict';
const root = new URL('..', import.meta.url);
const panel = fs.readFileSync(new URL('./src/pages/admin/SeniorPanel.tsx', root), 'utf8');
const member = fs.readFileSync(new URL('./src/components/admin/SeniorMemberActions.tsx', root), 'utf8');
const suspendedModal = fs.readFileSync(new URL('./src/components/admin/SuspendedMembersModal.tsx', root), 'utf8');
const service = fs.readFileSync(new URL('./src/services/seniorAccountAdministrationService.ts', root), 'utf8');
const availability = fs.readFileSync(new URL('./src/services/workModeAvailabilityService.ts', root), 'utf8');
const combined = [panel, member, suspendedModal, service].join('\n');
const requiredPanel = [
  'Suspensão operacional', 'Encerrar suspensão operacional', 'Suspender conta', 'Reativar conta',
  'Excluir perfil/conta', 'Remover da frota', 'Responsável pela empresa', 'Conta ativa', 'Conta suspensa',
  'Controle de envio de viagens', 'Membros suspensos', 'Consulta persistida no servidor', 'Encerrar suspensão',
  'Não foi possível consultar os membros suspensos no servidor.',
  'Não foi possível concluir a operação no servidor.',
];
for (const marker of requiredPanel) assert.ok(combined.includes(marker), marker);
for (const marker of ['removeDriverFromFleetSenior','suspendSeniorAccount','reactivateSeniorAccount','deleteSeniorProfile','reverseSeniorSuspension','endSeniorOperationalSuspension','listSeniorSuspendedMembers']) assert.ok(service.includes(marker), marker);
for (const marker of ['updateWorkModeAvailability','getWorkModeAvailability','print','pro','max']) assert.ok(availability.includes(marker), marker);
for (const marker of ['setAction("reverse")','listSeniorSuspendedMembers','toast.error']) assert.ok(combined.includes(marker), marker);
assert.doesNotMatch(member, /\balert\s*\(/, 'Senior actions must not use alert()');
console.log('PASS: senior administration source contract');
