import { InProcessEventPublisher } from 'typeorm-unit-of-work';
import { OrderHistory } from './order-history.js';
import { OrderShipped } from './order-shipped.js';
import type { ScenarioLog } from './scenario-log.js';

export function createHistoryRecordingPublisher(log: ScenarioLog): InProcessEventPublisher {
  const publisher = new InProcessEventPublisher();
  publisher.onBeforeCommit(OrderShipped, async (event, tx) => {
    await tx.getRepository(OrderHistory).save(OrderHistory.record(event.orderId, 'shipped'));
    log.record(`before commit: history recorded for ${event.orderId}`);
  });
  return publisher;
}
