const { sameScope, validScope } = require('./session.cjs');
class AutomationCommands {
  constructor(options) { Object.assign(this, options); }
  start(input) {
    const scope = this.getScope();
    if (!scope || scope.closed || input?.driverId !== this.getUid() || !sameScope(scope, input)) throw Error('WINDOWS_OPERATION_NOT_READY');
    try { this.integration.assertReady(input.simulatorKey, this.store); } catch (error) { this.navigate('setup'); throw error; }
    this.store.start(input); this.show(); this.emit(); return this.status();
  }
  async execute(action) {
    if (!this.getUid()) throw Error('Faça login na NVU.');
    const scope = this.store.live || this.getScope();
    if (action === 'pause') { if (!this.store.live) throw Error('Ative o PRO antes de pausar.'); this.store.pause(); }
    else if (action === 'resume') this.start(this.getScope());
    else if (action === 'stop') {
      const original = this.store.live;
      if (!original) throw Error('A sessão PRO já está encerrada.');
      if (await this.confirmStop()) {
        if (this.store.live !== original) throw Error('A sessão mudou durante a confirmação. Abra novamente as ações.');
        this.store.stop();
      }
    } else if (['panel', 'trips', 'setup'].includes(action)) {
      if (action === 'trips' && (!validScope(scope) || scope.driverId !== this.getUid())) throw Error('Selecione uma operação válida para abrir suas viagens.');
      this.navigate(action);
    } else if (action === 'game') {
      if (!validScope(scope) || scope.driverId !== this.getUid()) throw Error('Selecione uma operação válida.');
      await this.openGame(scope.simulatorKey);
    } else throw Error('OVERLAY_ACTION_DENIED');
    this.emit(); return this.status();
  }
}
module.exports = { AutomationCommands };
