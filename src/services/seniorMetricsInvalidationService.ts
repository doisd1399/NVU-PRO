import { onCanonicalTripUpdated } from '../lib/CanonicalTripUpdateEvent';

/**
 * Mantém a projeção do Painel Sênior alinhada após confirmação de viagem.
 * A atualização real das métricas permanece no backend; este listener apenas
 * invalida a projeção local para evitar exibição de valores antigos.
 */
export function registerSeniorMetricsInvalidation(onInvalidate?: () => void): () => void {
  return onCanonicalTripUpdated(() => {
    if (typeof onInvalidate === 'function') {
      onInvalidate();
    }
  });
}
