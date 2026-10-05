import { DataSource } from 'typeorm';
import { Order } from './order.js';
import { OrderHistory } from './order-history.js';

export function createDataSource(): DataSource {
  return new DataSource({
    type: 'better-sqlite3',
    database: ':memory:',
    entities: [Order, OrderHistory],
    synchronize: true,
  });
}
