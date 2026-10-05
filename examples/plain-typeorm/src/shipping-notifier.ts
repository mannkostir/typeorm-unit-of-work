import type { ScenarioLog } from './scenario-log.js';

export class ShippingNotifier {
  constructor(private readonly log: ScenarioLog) {}

  notifyShipped(orderId: string): void {
    this.log.record(`after commit: shipping notice sent for ${orderId}`);
  }
}
