import React, { useId, useState, useSyncExternalStore } from 'react';
import { ChevronDown, Play, Volume2, VolumeX } from 'lucide-react';
import { voiceAssistant } from '../lib/voiceAssistant';
import './VoiceAssistantSettings.css';

/** One shared entry for GlobalMenu's floating and lateral renderings. */
export function VoiceAssistantSettings() {
  const state = useSyncExternalStore(voiceAssistant.subscribe, voiceAssistant.getSnapshot, voiceAssistant.getSnapshot);
  const [expanded, setExpanded] = useState(false);
  const { settings } = state;
  const radioName = useId();
  return <section className="nvu-voice-settings" aria-label="Assistente de voz">
    <div className="nvu-voice-heading">
      <button type="button" className="nvu-voice-heading-button" aria-expanded={expanded} onClick={() => setExpanded(!expanded)}>
        {settings.enabled ? <Volume2 size={16} /> : <VolumeX size={16} />}
        <span>Assistente de voz<small>{settings.enabled ? `${settings.voice === 'male' ? 'Masculina' : 'Feminina'} · ${settings.mode === 'quiet' ? 'Discreto' : 'Completo'}` : 'Desativado'}</small></span>
        <ChevronDown size={14} className={expanded ? 'is-expanded' : ''} />
      </button>
      <button type="button" className="nvu-voice-switch" role="switch" aria-label="Ativar assistente de voz" aria-checked={settings.enabled}
        onClick={() => voiceAssistant.updateSettings({ enabled: !settings.enabled })}><span /></button>
    </div>
    {expanded && <div className="nvu-voice-options">
      <fieldset><legend>Voz</legend><div className="nvu-voice-choice">
        {(['male', 'female'] as const).map(voice => <label key={voice} className={settings.voice === voice ? 'is-selected' : ''}>
          <input type="radio" name={radioName} value={voice} checked={settings.voice === voice} onChange={() => voiceAssistant.updateSettings({ voice })} />
          {voice === 'male' ? 'Masculina' : 'Feminina'}</label>)}
      </div></fieldset>
      <label className="nvu-voice-volume"><span>Volume <output>{Math.round(settings.volume * 100)}%</output></span>
        <input type="range" min="0" max="100" step="5" value={Math.round(settings.volume * 100)} aria-label="Volume do assistente"
          onChange={event => voiceAssistant.updateSettings({ volume: Number(event.target.value) / 100 })} /></label>
      <label className="nvu-voice-mode">Modo<select aria-label="Frequência do assistente" value={settings.enabled ? settings.mode : 'disabled'}
        onChange={event => voiceAssistant.updateSettings(event.target.value === 'disabled' ? { enabled: false } : { enabled: true, mode: event.target.value === 'quiet' ? 'quiet' : 'complete' })}>
        <option value="complete">Completo</option><option value="quiet">Discreto</option><option value="disabled">Desativado</option></select></label>
      <p className="nvu-voice-hint">{settings.mode === 'quiet' ? 'Saudações e alertas essenciais.' : 'Saudações e eventos confirmados, com intervalos.'}</p>
      <button type="button" className="nvu-voice-preview" disabled={!settings.enabled || state.busy || state.waiting}
        onClick={() => voiceAssistant.preview()}><Play size={13} />{state.busy ? 'Reproduzindo…' : state.waiting ? 'Aguardando áudio…' : 'Ouvir exemplo'}</button>
      {state.needsInteraction && <p className="nvu-voice-hint" role="status">Toque em Ouvir exemplo para ativar o som.</p>}
      {state.failed && <p className="nvu-voice-hint" role="status">Áudio indisponível. Tente ouvir o exemplo novamente.</p>}
    </div>}
  </section>;
}
