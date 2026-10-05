import { Inject } from '@nestjs/common';
import { EventsHandler, type IEventHandler } from '@nestjs/cqrs';
import { OrderShipped } from './order-shipped.js';
import { ShippingNotifier } from './shipping-notifier.js';

@EventsHandler(OrderShipped)
export class OrderShippedHandler implements IEventHandler<OrderShipped> {
  constructor(@Inject(ShippingNotifier) private readonly notifier: ShippingNotifier) {}

  handle(event: OrderShipped): void {
    this.notifier.notifyShipped(event.orderId);
  }
}
