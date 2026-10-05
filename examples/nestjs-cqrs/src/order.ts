import { Column, Entity, PrimaryColumn } from 'typeorm';
import { AggregateRoot } from 'typeorm-unit-of-work';
import { OrderAlreadyShippedError } from './order-already-shipped-error.js';
import { OrderShipped } from './order-shipped.js';

export type OrderStatus = 'placed' | 'shipped';

@Entity()
export class Order extends AggregateRoot {
  @PrimaryColumn('text')
  id!: string;

  @Column('text')
  status!: OrderStatus;

  static place(id: string): Order {
    const order = new Order();
    order.id = id;
    order.status = 'placed';
    return order;
  }

  ship(): void {
    if (this.status === 'shipped') {
      throw new OrderAlreadyShippedError(this.id);
    }
    this.status = 'shipped';
    this.addDomainEvent(new OrderShipped(this.id));
  }
}
