import { Column, Entity, PrimaryGeneratedColumn } from 'typeorm';

@Entity()
export class OrderHistory {
  @PrimaryGeneratedColumn({ type: 'integer' })
  id!: number;

  @Column('text')
  orderId!: string;

  @Column('text')
  entry!: string;

  static record(orderId: string, entry: string): OrderHistory {
    const history = new OrderHistory();
    history.orderId = orderId;
    history.entry = entry;
    return history;
  }
}
