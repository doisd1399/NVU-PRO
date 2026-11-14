import { OperationTripConsumer } from './consumers/OperationTripConsumer';
import { HistoryTripConsumer } from './consumers/HistoryTripConsumer';

export class TripIntegrationBootstrap {
  static start(config?: {
    onOperationUpdated?: (trip: any) => void;
    onHistoryUpdated?: (trip: any) => void;
  }) {
    const stopOperation = OperationTripConsumer.start(config?.onOperationUpdated);
    const stopHistory = HistoryTripConsumer.start(config?.onHistoryUpdated);

    return () => {
      stopOperation();
      stopHistory();
    };
  }
}
