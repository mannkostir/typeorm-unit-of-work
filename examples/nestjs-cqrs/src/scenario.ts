import type { INestApplicationContext } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { Order } from './order.js';
import { OrderAlreadyShippedError } from './order-already-shipped-error.js';
import { OrderHistory } from './order-history.js';
import { ScenarioLog } from './scenario-log.js';
import { ShippingService } from './shipping.service.js';

export async function runScenario(app: INestApplicationContext): Promise<readonly string[]> {
  const log = app.get(ScenarioLog);
  const shipping = app.get(ShippingService);

  await shipping.place(['A', 'B']);

  log.record('shipping A');
  await shipping.ship(['A']);

  log.record('shipping B and A');
  await shipRecordingRollback(shipping, ['B', 'A'], log);

  log.record(await describeFinalState(app.get(DataSource)));
  return log.lines();
}

async function shipRecordingRollback(shipping: ShippingService, orderIds: readonly string[], log: ScenarioLog): Promise<void> {
  try {
    await shipping.ship(orderIds);
  } catch (error) {
    if (!(error instanceof OrderAlreadyShippedError)) {
      throw error;
    }
    log.record(`rolled back: ${error.message}`);
  }
}

async function describeFinalState(dataSource: DataSource): Promise<string> {
  const orders = dataSource.getRepository(Order);
  const a = await orders.findOneByOrFail({ id: 'A' });
  const b = await orders.findOneByOrFail({ id: 'B' });
  const historyEntries = await dataSource.getRepository(OrderHistory).count();
  return `final state: A ${a.status}, B ${b.status}, history entries: ${historyEntries}`;
}
