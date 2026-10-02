import { EntitySchema } from 'typeorm';
import { AggregateRoot } from '../../../src/events/aggregate-root';

export class OrderPlaced {
  constructor(readonly orderId: string) {}
}

export class OrderShipped {
  constructor(readonly orderId: string) {}
}

export class OrderCancelled {
  constructor(readonly orderId: string) {}
}

export class Order extends AggregateRoot {
  id = '';
  status = '';
  deletedAt: Date | null = null;

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

  cancel(): void {
    this.status = 'cancelled';
    this.addDomainEvent(new OrderCancelled(this.id));
  }
}

export class AuditEntry {
  id?: number;
  message = '';
}

export const orderSchema = new EntitySchema<Order>({
  name: 'Order',
  target: Order,
  columns: {
    id: { type: String, primary: true },
    status: { type: String },
    deletedAt: { type: Date, deleteDate: true, nullable: true },
  },
});

export const auditEntrySchema = new EntitySchema<AuditEntry>({
  name: 'AuditEntry',
  target: AuditEntry,
  columns: {
    id: { type: Number, primary: true, generated: true },
    message: { type: String },
  },
});
