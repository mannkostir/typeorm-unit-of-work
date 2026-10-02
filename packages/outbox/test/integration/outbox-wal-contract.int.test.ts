import type { DataSource } from 'typeorm';
import { InProcessEventPublisher, UnitOfWork } from 'typeorm-unit-of-work';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { OutboxEventPublisher } from '../../src/outbox-event-publisher';
import { openPostgres } from './support/databases';
import { Order, OrderPlaced } from './support/model';
import { storedOutboxRows } from './support/outbox-rows';
import { openWalSlot, type WalSlot } from './support/wal-slot';

describe('outbox WAL contract with rows deleted after insert', () => {
  let dataSource: DataSource;
  let wal: WalSlot;
  let uow: UnitOfWork;

  const placeOrder = (id: string) => uow.run(() => uow.getRepository(Order).save(Order.place(id)));

  beforeEach(async () => {
    dataSource = await openPostgres();
    wal = await openWalSlot(dataSource);
    const outbox = new OutboxEventPublisher({ inner: new InProcessEventPublisher() });
    outbox.register(OrderPlaced, {
      type: 'order.placed',
      aggregateType: 'order',
      aggregateId: (event) => event.orderId,
    });
    uow = new UnitOfWork({ dataSource, publisher: outbox, onAfterCommitError: () => {} });
  });

  afterEach(async () => {
    await wal.drop();
    await dataSource.destroy();
  });

  it('leaves the outbox table empty after commit', async () => {
    await placeOrder('o-1');

    expect(await storedOutboxRows(dataSource)).toEqual([]);
  });

  it('puts the committed insert into the WAL', async () => {
    await placeOrder('o-1');

    expect(await wal.committedOutboxInserts()).toEqual([
      expect.stringContaining(`aggregateid[character varying]:'o-1'`),
    ]);
  });

  it('puts no outbox insert into the WAL when the work throws', async () => {
    await uow
      .run(async () => {
        await uow.getRepository(Order).save(Order.place('o-1'));
        throw new Error('declined');
      })
      .catch(() => undefined);

    expect(await wal.committedOutboxInserts()).toEqual([]);
  });
});
