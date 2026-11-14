import { TripRegisteredEvent } from './TripRegisteredEvent';

export type TripRegisteredHandler = (event: TripRegisteredEvent) => void;

export class TripEventBus {
  private static handlers: TripRegisteredHandler[] = [];

  static subscribe(handler: TripRegisteredHandler) {
    this.handlers.push(handler);
    return () => {
      this.handlers = this.handlers.filter(item => item !== handler);
    };
  }

  static publish(event: TripRegisteredEvent) {
    this.handlers.forEach(handler => handler(event));
  }
}
