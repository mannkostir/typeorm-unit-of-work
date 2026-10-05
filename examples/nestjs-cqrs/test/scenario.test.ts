import type { INestApplicationContext } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { DataSource } from 'typeorm';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { AppModule } from '../src/app.module.js';
import { Order } from '../src/order.js';
import { OrderHistory } from '../src/order-history.js';
import { runScenario } from '../src/scenario.js';

describe('NestJS and @nestjs/cqrs example', () => {
  let app: INestApplicationContext;

  beforeEach(async () => {
    app = await NestFactory.createApplicationContext(AppModule, { logger: false });
  });

  afterEach(async () => {
    await app.close();
  });

  it('reports both phases for the committed shipment and only the rollback for the failed one', async () => {
    const lines = await runScenario(app);

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
    await runScenario(app);

    const order = await app.get(DataSource).getRepository(Order).findOneByOrFail({ id: 'B' });

    expect(order.status).toBe('placed');
  });

  it('keeps only the history entry written by the committed before-commit handler', async () => {
    await runScenario(app);

    const history = await app.get(DataSource).getRepository(OrderHistory).find();

    expect(history.map(({ orderId, entry }) => ({ orderId, entry }))).toEqual([{ orderId: 'A', entry: 'shipped' }]);
  });
});
