// Start-up as an explicit sequence of steps. A failure names the step, a stable code and what the person should do,
// instead of one generic message. Fatal steps stop the sequence; non-fatal steps are recorded as warnings and the
// application continues. User data is never removed or rewritten while recovering.
const { NvuError, describe } = require('./errors.cjs');
const { redact, redactDeep } = require('./redact.cjs');

async function runStartup({ steps, ctx, logger, now = Date.now }) {
  const report = { startedAt: new Date(now()).toISOString(), ok: true, fatal: null, steps: [] };
  for (const step of steps) {
    const entry = { id: step.id, title: step.title, ok: true, warning: false };
    const started = now();
    try {
      const data = await step.run(ctx);
      if (data !== undefined) entry.data = redactDeep(data);
    } catch (raw) {
      const error = raw instanceof NvuError ? raw : new NvuError(step.code || 'NVU-S999', String(raw?.message || raw), { cause: raw, fatal: step.fatal !== false });
      const d = describe(error.code), fatal = error.fatal !== false && step.fatal !== false;
      Object.assign(entry, { ok: false, warning: !fatal, code: d.code, problem: d.title, message: redact(error.message), action: d.action, fatal, details: redactDeep(error.details) });
      if (raw && raw.stack && !(raw instanceof NvuError)) entry.stack = redact(String(raw.stack)).split('\n').slice(0, 4).join('\n');
      logger.error('startup.step_failed', { step: step.id, code: d.code, fatal, message: entry.message, details: entry.details });
      if (fatal) { report.ok = false; report.fatal = entry; entry.ms = now() - started; report.steps.push(entry); break; }
    }
    entry.ms = now() - started; report.steps.push(entry);
    if (entry.ok) logger.info('startup.step_ok', { step: step.id, ms: entry.ms });
  }
  report.finishedAt = new Date(now()).toISOString();
  report.warnings = report.steps.filter(s => s.warning).map(s => ({ step: s.id, code: s.code, message: s.message }));
  return report;
}
function describeFailure(report, versions) {
  const f = report.fatal; if (!f) return '';
  return [`${f.problem}`, '', `O que aconteceu: ${f.message || f.problem}`, `Etapa: ${f.title}`, '', `O que fazer: ${f.action}`, '',
    `Código: ${f.code}`, `Versão: NVU ${versions?.app?.version || '?'} · interface ${versions?.web?.version || '?'} · plugin esperado ${versions?.plugin?.expectedVersion || '?'}`,
    `Executável: ${versions?.app?.executable || '?'}`].join('\n');
}
function diagnosticBundle({ report, versions, logger, extra }) {
  return redactDeep({ kind: 'nvu-windows-startup-diagnostic', version: 1, versions, startup: report, log: logger?.tail ? logger.tail(150) : [], ...extra });
}
/** Dialog loop: copy the diagnostic or open the log folder as many times as needed, then leave. */
async function presentStartupFailure({ report, versions, logger, dialogs, clipboard, shell, noDialogs }) {
  const detail = describeFailure(report, versions);
  logger.error('startup.fatal', { code: report.fatal?.code, step: report.fatal?.id });
  if (noDialogs) return { shown: false, detail };
  for (;;) {
    const answer = await dialogs.show({ type: 'error', title: 'NVU PRO', message: 'A NVU não pôde iniciar', detail, buttons: ['Copiar diagnóstico', 'Abrir pasta de registros', 'Sair'], defaultId: 2, cancelId: 2 });
    if (answer.response === 0) clipboard.writeText(JSON.stringify(diagnosticBundle({ report, versions, logger }), null, 2));
    else if (answer.response === 1) await shell.openPath(logger.dir);
    else return { shown: true, detail };
  }
}
module.exports = { runStartup, describeFailure, diagnosticBundle, presentStartupFailure };
