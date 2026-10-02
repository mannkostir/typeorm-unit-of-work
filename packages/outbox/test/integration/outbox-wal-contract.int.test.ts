import type { DataSource } from 'typeorm';
import { InProcessEventPublisher, UnitOfWork } from 'typeorm-unit-of-work';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { OutboxEventPublisher } from '../../src/outbox-event-publisher';
import { openPostgres } from './support/databases';
import { Order, OrderPlaced } from './support/model';
import { storedOutboxRows } from './support/outbox-rows';
import { type QueryRunnerWatch, watchQueryRunners } from './support/query-runner-watch';
import { openWalSlot, type WalSlot } from './support/wal-slot';

describe('outbox WAL contract with rows deleted after insert', () => {
  let dataSource: DataSource;
  let queryRunners: QueryRunnerWatch;
  let wal: WalSlot;
  let uow: UnitOfWork;

  const placeOrder = (id: string) => uow.run(() => uow.getRepository(Order).save(Order.place(id)));

  beforeEach(async () => {
    dataSource = await openPostgres();
    queryRunners = watchQueryRunners(dataSource);
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
    try {
      expect(queryRunners.unreleasedCount()).toBe(0);
    } finally {
      await wal.drop();
      await dataSource.destroy();
    }
  });

  it('leaves the outbox table empty after commit', async () => {
    await placeOrder('o-1');

    expect(await storedOutboxRows(dataSource)).toEqual([]);
  });

  it('deletes only the rows written by that call', async () => {
    const foreignId = '00000000-0000-4000-8000-000000000000';
    await dataSource.query(
      `INSERT INTO "outbox" ("id", "aggregatetype", "aggregateid", "type", "payload") VALUES ($1, 'order', 'foreign', 'order.foreign', NULL)`,
      [foreignId],
    );

    await placeOrder('o-1');

    expect((await storedOutboxRows(dataSource)).map((row) => row.id)).toEqual([foreignId]);
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
