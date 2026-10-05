import { Inject, Injectable } from '@nestjs/common';
import { ScenarioLog } from './scenario-log.js';

@Injectable()
export class ShippingNotifier {
  constructor(@Inject(ScenarioLog) private readonly log: ScenarioLog) {}

  notifyShipped(orderId: string): void {
    this.log.record(`after commit: shipping notice sent for ${orderId}`);
  }
}
