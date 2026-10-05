import type { DataSource } from 'typeorm';
import { InProcessEventPublisher, UnitOfWork } from 'typeorm-unit-of-work';
import { OrderHistory } from './order-history.js';
import { OrderShipped } from './order-shipped.js';
import type { ScenarioLog } from './scenario-log.js';
import { ShippingNotifier } from './shipping-notifier.js';

export function createUnitOfWork(dataSource: DataSource, log: ScenarioLog): UnitOfWork {
  const notifier = new ShippingNotifier(log);
  const publisher = new InProcessEventPublisher();

  publisher.onBeforeCommit(OrderShipped, async (event, tx) => {
    await tx.getRepository(OrderHistory).save(OrderHistory.record(event.orderId, 'shipped'));
    log.record(`before commit: history recorded for ${event.orderId}`);
  });
  publisher.onAfterCommit(OrderShipped, (event) => notifier.notifyShipped(event.orderId));

  return new UnitOfWork({
    dataSource,
    publisher,
    onAfterCommitError: (error) => log.record(`after-commit handler failed: ${String(error)}`),
  });
}
