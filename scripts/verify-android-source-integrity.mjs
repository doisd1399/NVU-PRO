import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

const root = process.cwd();
const required = [
  'src/pages/admin/SeniorPanel.tsx',
  'src/components/admin/SeniorMemberActions.tsx',
  'src/components/admin/SuspendedMembersModal.tsx',
  'src/components/admin/WorkModeAvailabilityModal.tsx',
  'src/services/seniorAccountAdministrationService.ts',
  'src/services/workModeAvailabilityService.ts',
  'src/layouts/AdminLayout.tsx',
  'src/layouts/DriverLayout.tsx',
  'src/components/GlobalMenu.tsx',
  'src/components/common/NvuStatusBarController.tsx',
  'src/hooks/useProfileChrome.ts',
  'src/context/AppContext.tsx',
  'scripts/test-admin-profile-menu-reference.mjs',
  'scripts/test-profile-header-reference.mjs',
  'scripts/test-senior-administration-contract.mjs',
  'scripts/test-profile-menu-navigation-root-cause.mjs',
  'scripts/test-unified-profile-menu.mjs',
];
const markers = [
  'Suspensão operacional', 'Encerrar suspensão operacional', 'Suspender conta',
  'Reativar conta', 'Excluir perfil/conta', 'Remover da frota',
  'Responsável pela empresa', 'Conta ativa', 'Conta suspensa',
  'Controle de envio', 'Membros suspensos', 'Consulta persistida no servidor', 'Encerrar suspensão',
  'removeDriverFromFleetSenior', 'suspendSeniorAccount', 'reactivateSeniorAccount',
  'deleteSeniorProfile', 'reverseSeniorSuspension', 'endSeniorOperationalSuspension',
  'listSeniorSuspendedMembers', 'updateWorkModeAvailability',
  '/admin/fleet', '/driver/profile', 'switchRole', 'onSwitchRole',
  'useProfileChrome(isCompanyProfileRoute)', '.nvu-profile-hero, .nvu-cover-hero'
];
const sha256 = p => crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex');
const source = required.map(p => ({p, ok: fs.existsSync(path.join(root,p))}));
const sourceText = source.filter(x => x.ok).map(x => fs.readFileSync(path.join(root,x.p),'utf8')).join('\n');
const missing = source.filter(x => !x.ok).map(x => x.p);
const missingMarkers = markers.filter(m => !sourceText.includes(m));
const dist = path.join(root,'dist');
const assets = path.join(root,'android','app','src','main','assets','public');
const generatedDirty = fs.existsSync(dist) || (fs.existsSync(assets) && fs.readdirSync(assets).some((name) => name !== '.gitkeep'));
const pkg = JSON.parse(fs.readFileSync(path.join(root,'package.json'),'utf8'));
const result = {
  status: missing.length || missingMarkers.length || generatedDirty || typeof pkg.scripts?.build !== 'string' ? 'BLOCKED' : 'PASS',
  sourceRequired: source.length,
  sourceMissing: missing,
  markerCount: markers.length,
  markerMissing: missingMarkers,
  generatedAssetsClean: !generatedDirty,
  webBuildScriptPresent: typeof pkg.scripts?.build === 'string',
};
console.log(JSON.stringify(result,null,2));
process.exit(result.status === 'PASS' ? 0 : 2);
