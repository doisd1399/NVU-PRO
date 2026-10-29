import { CanonicalTrip } from '../../domain/trip/CanonicalTrip';
import { TripRegistrationService } from './TripRegistrationService';

/**
 * Prepara a identidade canônica do registro. Não publica eventos antes da
 * persistência: o repository offline-first é o primeiro ponto em que a viagem
 * está realmente gravada e pode ser consumida por Histórico/Operação.
 */
export class TripRegistrationCoordinator {
  static register(input: Partial<CanonicalTrip>): CanonicalTrip {
    return TripRegistrationService.register(input);
  }
}
