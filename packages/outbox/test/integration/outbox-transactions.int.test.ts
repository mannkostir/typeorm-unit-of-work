import type { DataSource } from 'typeorm';
import { InProcessEventPublisher, UnitOfWork } from 'typeorm-unit-of-work';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { OutboxEventPublisher } from '../../src/outbox-event-publisher';
import { openPostgres } from './support/databases';
import { Order, OrderNoted, OrderPlaced, OrderShipped } from './support/model';
import { storedOutboxRows } from './support/outbox-rows';
import { type QueryRunnerWatch, watchQueryRunners } from './support/query-runner-watch';

describe('outbox rows across transaction boundaries', () => {
  let dataSource: DataSource;
  let queryRunners: QueryRunnerWatch;
  let inner: InProcessEventPublisher;
  let outbox: OutboxEventPublisher;
  let uow: UnitOfWork;

  const saveNewOrder = (id: string) => uow.getRepository(Order).save(Order.place(id));
  const storedAggregateIds = async () => (await storedOutboxRows(dataSource)).map((row) => row.aggregateid);

  const open = async (table = 'outbox') => {
    dataSource = await openPostgres(table);
    queryRunners = watchQueryRunners(dataSource);
    inner = new InProcessEventPublisher();
    outbox = new OutboxEventPublisher({ inner, table, rows: 'retain' });
    outbox.register(OrderPlaced, { type: 'order.placed', aggregateType: 'order', aggregateId: (event) => event.orderId });
    outbox.register(OrderShipped, { type: 'order.shipped', aggregateType: 'order', aggregateId: (event) => event.orderId });
    outbox.register(OrderNoted, { type: 'order.noted', aggregateType: 'order', aggregateId: (event) => event.orderId });
    uow = new UnitOfWork({ dataSource, publisher: outbox, onAfterCommitError: () => {} });
  };

  afterEach(async () => {
    await dataSource.destroy();
  });

  describe('on the default table', () => {
    beforeEach(async () => {
      await open();
    });

    it('stores nothing when the work throws', async () => {
      await uow
        .run(async () => {
          await saveNewOrder('o-1');
          throw new Error('declined');
        })
        .catch(() => undefined);

      expect(await storedOutboxRows(dataSource)).toEqual([]);
    });

    it('stores nothing when commitWhen rejects the result', async () => {
      await uow.run(() => saveNewOrder('o-1'), { commitWhen: () => false });

      expect(await storedOutboxRows(dataSource)).toEqual([]);
    });

    it('stores nothing from a joined run when the outer run fails', async () => {
      await uow
        .run(async () => {
          await uow.run(() => saveNewOrder('o-1'));
          throw new Error('declined');
        })
        .catch(() => undefined);

      expect(await storedOutboxRows(dataSource)).toEqual([]);
    });

    it('keeps the rows of a new run when the outer run fails', async () => {
      await uow
        .run(async () => {
          await saveNewOrder('o-1');
          await uow.run(() => saveNewOrder('o-2'), { propagation: 'new' });
          throw new Error('declined');
        })
        .catch(() => undefined);

      expect(await storedAggregateIds()).toEqual(['o-2']);
    });

    it('drops the events of a nested run that rolls back and keeps the outer ones', async () => {
      await uow.run(async () => {
        await saveNewOrder('o-1');
        await uow
          .run(
            async () => {
              await saveNewOrder('o-2');
              throw new Error('declined');
            },
            { propagation: 'nested' },
          )
          .catch(() => undefined);
      });

      expect(await storedAggregateIds()).toEqual(['o-1']);
    });

    it('stores events raised by before-commit handlers in later rounds', async () => {
      inner.onBeforeCommit(OrderPlaced, async (event, context) => {
        const orders = context.getRepository(Order);
        const order = await orders.findOneByOrFail({ id: event.orderId });
        order.ship();
        await orders.save(order);
      });

      await uow.run(() => saveNewOrder('o-1'));

      expect((await storedOutboxRows(dataSource)).map((row) => row.type)).toEqual(['order.placed', 'order.shipped']);
    });

    it('stores all 1,001 events of one round', async () => {
      await uow.run(async () => {
        const order = Order.place('o-1');
        Array.from({ length: 1000 }, (_, index) => order.note(`note ${index}`));
        await uow.getRepository(Order).save(order);
      });

      expect(await dataSource.query('SELECT count(*)::int AS count FROM "outbox"')).toEqual([{ count: 1001 }]);
    });

    it('rejects a payload containing \\u0000 with the Postgres error and stores nothing', async () => {
      const run = uow.run(async () => {
        const order = Order.place('o-1');
        order.note('nul\u0000byte');
        await uow.getRepository(Order).save(order);
      });

      await expect(run).rejects.toThrow(/unsupported Unicode escape sequence/);
      expect(await dataSource.getRepository(Order).count()).toBe(0);
    });

    it('releases every query runner when Postgres rejects a payload', async () => {
      await uow
        .run(async () => {
          const order = Order.place('o-1');
          order.note('nul\u0000byte');
          await uow.getRepository(Order).save(order);
        })
        .catch(() => undefined);

      expect(queryRunners.unreleasedCount()).toBe(0);
    });
  });

  describe('on a schema-qualified table', () => {
    beforeEach(async () => {
      await open('app.outbox');
    });

    it('writes into that schema', async () => {
      await uow.run(() => saveNewOrder('o-1'));

      expect((await storedOutboxRows(dataSource, '"app"."outbox"')).map((row) => row.aggregateid)).toEqual(['o-1']);
    });
  });
});
