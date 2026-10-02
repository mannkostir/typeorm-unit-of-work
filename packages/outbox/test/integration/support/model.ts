import { EntitySchema } from 'typeorm';
import { AggregateRoot } from 'typeorm-unit-of-work';

export class OrderPlaced {
  constructor(readonly orderId: string) {}
}

export class OrderShipped {
  constructor(readonly orderId: string) {}
}

export class OrderNoted {
  constructor(
    readonly orderId: string,
    readonly note: string,
  ) {}
}

export class Order extends AggregateRoot {
  id = '';
  status = '';

  static place(id: string): Order {
    const order = new Order();
    order.id = id;
    order.status = 'placed';
    order.addDomainEvent(new OrderPlaced(id));
    return order;
  }

  ship(): void {
    this.status = 'shipped';
    this.addDomainEvent(new OrderShipped(this.id));
  }

  note(text: string): void {
    this.addDomainEvent(new OrderNoted(this.id, text));
  }
}

export const orderSchema = new EntitySchema<Order>({
  name: 'Order',
  target: Order,
  columns: {
    id: { type: String, primary: true },
    status: { type: String },
  },
});
