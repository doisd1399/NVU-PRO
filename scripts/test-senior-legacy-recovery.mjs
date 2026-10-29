import fs from 'node:fs';
import assert from 'node:assert/strict';

const panel = fs.readFileSync('src/pages/admin/SeniorPanel.tsx', 'utf8');
const actions = fs.readFileSync('src/components/admin/SeniorMemberActions.tsx', 'utf8');
const workMode = fs.readFileSync('src/components/admin/WorkModeAvailabilityModal.tsx', 'utf8');
const service = fs.readFileSync('src/services/seniorAccountAdministrationService.ts', 'utf8');

for (const marker of [
  'expandedStaffCompanyId',
  'Funcionários (',
  'Nenhum membro carregado para esta empresa.',
  'Proprietário',
  'Responsável pela empresa',
  'Conta suspensa',
  'Perfil excluído',
  'triggerLabel="Ações"',
  'showStatusBadges={false}',
]) assert.ok(panel.includes(marker), `SeniorPanel missing: ${marker}`);

for (const marker of [
  'showStatusBadges?: boolean',
  'triggerClassName?: string',
  'Remover da frota',
  'Suspender conta',
  'Reativar conta',
  'Reverter suspensão',
  'Excluir perfil/conta',
]) assert.ok(actions.includes(marker), `SeniorMemberActions missing: ${marker}`);

for (const marker of [
  'Simuladores liberados',
  'Selecionar todos',
  'Desmarcar todos',
  'Colocar modo em manutenção?',
  'Confirmar {pendingModeToggle.nextEnabled ? "reativação" : "pausa"}',
  'Salvar controle',
  'WORK_MODE_SIMULATORS[mode]',
]) assert.ok(workMode.includes(marker), `WorkMode modal missing: ${marker}`);

for (const marker of [
  'removeDriverFromFleetSenior',
  'suspendSeniorAccount',
  'reactivateSeniorAccount',
  'deleteSeniorProfile',
  'reverseSeniorSuspension',
  'endSeniorOperationalSuspension',
]) assert.ok(service.includes(marker), `Senior service missing: ${marker}`);

console.log('PASS: visual and functional Senior Panel recovery markers are present');
