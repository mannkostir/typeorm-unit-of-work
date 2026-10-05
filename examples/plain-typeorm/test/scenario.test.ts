import type { DataSource } from 'typeorm';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createDataSource } from '../src/data-source.js';
import { Order } from '../src/order.js';
import { OrderHistory } from '../src/order-history.js';
import { runScenario } from '../src/scenario.js';

describe('plain TypeORM example', () => {
  let dataSource: DataSource;

  beforeEach(async () => {
    dataSource = await createDataSource().initialize();
  });

  afterEach(async () => {
    await dataSource.destroy();
  });

  it('reports both phases for the committed shipment and only the rollback for the failed one', async () => {
    const lines = await runScenario(dataSource);

    expect(lines).toEqual([
      'shipping A',
      'before commit: history recorded for A',
      'after commit: shipping notice sent for A',
      'shipping B and A',
      'rolled back: order A is already shipped',
      'final state: A shipped, B placed, history entries: 1',
    ]);
  });

  it('leaves the order saved inside the rolled-back transaction unshipped', async () => {
    await runScenario(dataSource);

    const order = await dataSource.getRepository(Order).findOneByOrFail({ id: 'B' });

    expect(order.status).toBe('placed');
  });

  it('keeps only the history entry written by the committed before-commit handler', async () => {
    await runScenario(dataSource);

    const history = await dataSource.getRepository(OrderHistory).find();

    expect(history.map(({ orderId, entry }) => ({ orderId, entry }))).toEqual([{ orderId: 'A', entry: 'shipped' }]);
  });
});
