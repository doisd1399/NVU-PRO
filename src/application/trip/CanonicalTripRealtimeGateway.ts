/**
 * Etapa 19.14 - Gateway realtime canônico.
 *
 * Esta camada é a única porta permitida para consumidores de realtime
 * após a migração. O transporte Firebase deve ser conectado ao SyncEngine
 * / CanonicalTripStore e nunca exposto aos hooks.
 */
export type CanonicalTripRealtimeListener<T> = (trips: T[]) => void;

export interface CanonicalTripRealtimeGateway<T> {
  subscribe(listener: CanonicalTripRealtimeListener<T>): () => void;
}

export class CanonicalTripRealtimeService<T>
  implements CanonicalTripRealtimeGateway<T>
{
  constructor(
    private readonly subscribeSource: (
      listener: CanonicalTripRealtimeListener<T>
    ) => () => void
  ) {}

  subscribe(listener: CanonicalTripRealtimeListener<T>): () => void {
    return this.subscribeSource(listener);
  }
}
