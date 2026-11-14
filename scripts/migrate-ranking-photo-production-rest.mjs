#!/usr/bin/env node
// Retired: HEAD-only validation and an unconditional PATCH could overwrite a
// concurrent upload. Never silently expand a previously approved backup scope.
throw new Error('Migrador REST antigo desativado. Use functions/scripts/migrate-ranking-vehicle-photos.mjs em dry-run; revise o relatório antes de executar a migração validada.');
