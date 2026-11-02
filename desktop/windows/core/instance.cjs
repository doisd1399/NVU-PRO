// Single-instance policy. The process that loses the lock does NOTHING except decide what to tell the person:
// no services, no windows, no shortcut, no bridge access, no journal. It either exits, or (with explicit consent)
// replaces the previous NVU after that one has closed.
const { identifyNvu, compareVersions, sameFile } = require('./process-list.cjs');
const { describe } = require('./errors.cjs');

function createInstance({ app, cli = {}, self, find, readPackage, dialogs, killer, alive, sleep = ms => new Promise(r => setTimeout(r, ms)), logger, now = Date.now }) {
  const payload = (extra = {}) => ({ product: 'nvu-pro', pid: self.pid, version: self.version, exe: self.exe, ...extra });
  async function owners() {
    let raw = []; try { raw = await find(); } catch (error) { logger.warn('instance.process_list_failed', { message: String(error.message || error) }); }
    return raw.filter(p => p.pid !== self.pid).map(p => identifyNvu(p, readPackage)).filter(Boolean);
  }
  async function waitUntil(predicate, ms, step = 200) { const end = now() + ms; for (;;) { if (await predicate()) return true; if (now() >= end) return false; await sleep(step); } }
  const say = async options => cli.noDialogs ? { response: options.defaultId ?? 0, suppressed: true } : dialogs.show(options);
  const failure = async (code, extra = '') => { const d = describe(code); await say({ type: 'warning', title: 'NVU PRO', message: d.title, detail: `${extra ? extra + '\n\n' : ''}${d.action}\n\nCódigo: ${d.code}`, buttons: ['OK'], defaultId: 0 }); };

  /** Called in the process that HOLDS the lock when someone else tries to start. */
  function primaryHandler({ show, quit }) {
    return async (_event, _argv, _cwd, data) => {
      try { show(); } catch (error) { logger.warn('instance.show_failed', { message: String(error.message || error) }); }
      if (!data || data.product !== 'nvu-pro') return;
      logger.info('instance.second_started', { peer: { pid: data.pid, version: data.version, exe: data.exe }, takeover: data.takeover === true });
      if (data.takeover !== true || !Number.isSafeInteger(data.pid)) return;
      // Only an authentic NVU process, started by the same Windows user, may ask this instance to close.
      const peer = (await owners()).find(o => o.pid === data.pid);
      if (!peer?.verified) { logger.warn('instance.takeover_refused', { pid: data.pid }); return; }
      logger.info('instance.takeover_accepted', { pid: peer.pid, peerVersion: peer.version });
      quit();
    };
  }

  async function takeover(owner) {
    logger.info('instance.takeover_start', { owner: { pid: owner.pid, version: owner.version, exe: owner.exe } });
    // The failed lock request also delivers this message to the running instance. New versions close by themselves.
    let acquired = app.requestSingleInstanceLock(payload({ takeover: true }));
    if (!acquired && !(await waitUntil(() => !alive(owner.pid), 6000))) {
      // Old versions ignore the message. Ask Windows politely first (closes visible windows only).
      try { await killer.close(owner.pid); } catch { /* may be hidden in the tray */ }
      if (!(await waitUntil(() => !alive(owner.pid), 4000))) {
        if (!owner.verified) return { ok: false, reason: 'owner-not-verified' };
        const answer = await say({ type: 'warning', title: 'NVU PRO', message: 'A versão anterior da NVU não respondeu',
          detail: `O processo ${owner.pid} (versão ${owner.version || 'desconhecida'}) em\n${owner.exe}\nnão fechou sozinho. Encerrar somente esse processo da NVU agora?\n\nAs viagens pendentes continuam salvas em %APPDATA%\\NVU PRO\\pro-journal.json.`,
          buttons: ['Encerrar a NVU anterior', 'Cancelar'], defaultId: 1, cancelId: 1 });
        if (answer.response !== 0) return { ok: false, reason: 'force-declined' };
        logger.warn('instance.force_close', { pid: owner.pid });
        try { await killer.force(owner.pid); } catch (error) { logger.error('instance.force_close_failed', { message: String(error.message || error) }); return { ok: false, reason: 'force-failed' }; }
        if (!(await waitUntil(() => !alive(owner.pid), 5000))) return { ok: false, reason: 'still-running' };
      }
    }
    if (!acquired) acquired = await waitUntil(() => app.requestSingleInstanceLock(payload()), 10000, 500);
    return { ok: acquired === true, reason: acquired ? 'acquired' : 'lock-not-released' };
  }

  /** Called in the process that did NOT get the lock. Returns { primary, exitCode, kind }. */
  async function handleLostLock() {
    logger.info('instance.lock_lost', { self });
    const found = await owners(), owner = found.find(o => o.verified) || null;
    if (!owner) {
      await failure('NVU-I030', found.length ? 'Foi encontrado outro programa com o mesmo nome, mas ele não é uma NVU reconhecida; nada foi encerrado.' : '');
      return { primary: false, exitCode: 3, kind: 'unknown-owner' };
    }
    const order = compareVersions(self.version, owner.version);
    if (order === 0 || sameFile(owner.exe, self.exe)) {
      logger.info('instance.same_version', { owner: { pid: owner.pid, version: owner.version } });
      return { primary: false, exitCode: 0, kind: 'same-instance', owner };
    }
    const newer = order > 0, d = describe('NVU-I020');
    const answer = await say({ type: 'question', title: 'NVU PRO', message: newer ? 'Uma versão anterior da NVU ainda está aberta' : 'Uma versão mais nova da NVU já está aberta',
      detail: `Já aberta: versão ${owner.version || 'desconhecida'}\n${owner.exe}\n\nEsta: versão ${self.version}\n${self.exe}\n\n${newer ? 'Enquanto a anterior estiver aberta, você continua vendo a tela e o plugin esperado dela. ' : ''}Suas viagens pendentes ficam salvas e passam para a versão que ficar aberta.\n\n${d.action}`,
      buttons: newer ? ['Fechar a anterior e abrir esta versão', 'Voltar à versão que já está aberta'] : ['Voltar à versão que já está aberta', 'Fechar a mais nova e abrir esta versão'], defaultId: newer ? 0 : 0, cancelId: newer ? 1 : 0 });
    const wantsSwitch = newer ? answer.response === 0 : answer.response === 1;
    if (!wantsSwitch || answer.suppressed) { logger.info('instance.kept_running', { owner: owner.version, switch: false, suppressed: !!answer.suppressed }); return { primary: false, exitCode: answer.suppressed ? 4 : 0, kind: 'other-version-kept', owner }; }
    const result = await takeover(owner);
    if (result.ok) { logger.info('instance.takeover_done', { owner: owner.version }); return { primary: true, exitCode: 0, kind: 'took-over', owner }; }
    logger.error('instance.takeover_failed', { reason: result.reason });
    await failure('NVU-I040', `Motivo técnico: ${result.reason}`);
    return { primary: false, exitCode: 5, kind: 'takeover-failed', owner, reason: result.reason };
  }
  return { payload, requestLock: () => app.requestSingleInstanceLock(payload()), primaryHandler, handleLostLock, takeover, owners };
}
module.exports = { createInstance };
