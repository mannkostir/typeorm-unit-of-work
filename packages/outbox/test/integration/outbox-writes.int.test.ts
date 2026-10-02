import type { DataSource } from 'typeorm';
import { InProcessEventPublisher, UnitOfWork } from 'typeorm-unit-of-work';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { OutboxMappingError, UnsupportedDriverError } from '../../src/errors/outbox-errors';
import { OutboxEventPublisher } from '../../src/outbox-event-publisher';
import { openPostgres, openSqlite } from './support/databases';
import { Order, OrderNoted, OrderPlaced, OrderShipped } from './support/model';
import { storedOutboxRows, uuidPattern } from './support/outbox-rows';
import { type QueryRunnerWatch, watchQueryRunners } from './support/query-runner-watch';

const unitOfWork = (dataSource: DataSource, publisher: OutboxEventPublisher) =>
  new UnitOfWork({ dataSource, publisher, onAfterCommitError: () => {} });

const registerPlaced = (outbox: OutboxEventPublisher) =>
  outbox.register(OrderPlaced, { type: 'order.placed', aggregateType: 'order', aggregateId: (event) => event.orderId });

describe('outbox writes on postgres', () => {
  let dataSource: DataSource;
  let queryRunners: QueryRunnerWatch;
  let inner: InProcessEventPublisher;
  let outbox: OutboxEventPublisher;
  let uow: UnitOfWork;

  const saveNewOrder = (id: string) => uow.getRepository(Order).save(Order.place(id));

  beforeEach(async () => {
    dataSource = await openPostgres();
    queryRunners = watchQueryRunners(dataSource);
    inner = new InProcessEventPublisher();
    outbox = new OutboxEventPublisher({ inner, rows: 'retain' });
    registerPlaced(outbox);
    uow = unitOfWork(dataSource, outbox);
  });

  afterEach(async () => {
    await dataSource.destroy();
  });

  it('stores a committed event as an outbox row', async () => {
    await uow.run(() => saveNewOrder('o-1'));

    expect(await storedOutboxRows(dataSource)).toEqual([
      {
        id: expect.stringMatching(uuidPattern),
        aggregatetype: 'order',
        aggregateid: 'o-1',
        type: 'order.placed',
        payload: { orderId: 'o-1' },
      },
    ]);
  });

  it('stores the mapped payload', async () => {
    outbox.register(OrderNoted, {
      type: 'order.noted',
      aggregateType: 'order',
      aggregateId: (event) => event.orderId,
      payload: (event) => ({ text: event.note }),
    });

    await uow.run(async () => {
      const order = Order.place('o-1');
      order.note('fragile');
      await uow.getRepository(Order).save(order);
    });

    expect((await storedOutboxRows(dataSource)).map((row) => row.payload)).toEqual([{ text: 'fragile' }, { orderId: 'o-1' }]);
  });

  it('stores a null payload as SQL NULL', async () => {
    outbox.register(OrderShipped, {
      type: 'order.shipped',
      aggregateType: 'order',
      aggregateId: (event) => event.orderId,
      payload: () => null,
    });

    await uow.run(async () => {
      const order = Order.place('o-1');
      order.ship();
      await uow.getRepository(Order).save(order);
    });

    expect((await storedOutboxRows(dataSource)).find((row) => row.type === 'order.shipped')?.payload).toBeNull();
  });

  it('delivers unregistered events to the inner publisher without storing them', async () => {
    const delivered: object[] = [];
    inner.onAfterCommit(OrderShipped, (event) => {
      delivered.push(event);
    });

    await uow.run(async () => {
      const order = Order.place('o-1');
      order.ship();
      await uow.getRepository(Order).save(order);
    });

    expect([delivered, (await storedOutboxRows(dataSource)).map((row) => row.type)]).toEqual([
      [new OrderShipped('o-1')],
      ['order.placed'],
    ]);
  });

  it('rolls the business write back when a mapper fails', async () => {
    outbox.register(OrderShipped, {
      type: 'order.shipped',
      aggregateType: 'order',
      aggregateId: () => {
        throw new Error('no id');
      },
    });

    const run = uow.run(async () => {
      const order = Order.place('o-1');
      order.ship();
      await uow.getRepository(Order).save(order);
    });

    await expect(run).rejects.toBeInstanceOf(OutboxMappingError);
    expect(await dataSource.getRepository(Order).count()).toBe(0);
  });

  it('releases every query runner when a mapper fails', async () => {
    outbox.register(OrderShipped, {
      type: 'order.shipped',
      aggregateType: 'order',
      aggregateId: () => '',
    });

    await uow
      .run(async () => {
        const order = Order.place('o-1');
        order.ship();
        await uow.getRepository(Order).save(order);
      })
      .catch(() => undefined);

    expect(queryRunners.unreleasedCount()).toBe(0);
  });
});

describe('outbox writes on sqlite', () => {
  let dataSource: DataSource;
  let queryRunners: QueryRunnerWatch;
  let uow: UnitOfWork;

  beforeEach(async () => {
    dataSource = await openSqlite();
    queryRunners = watchQueryRunners(dataSource);
    const outbox = new OutboxEventPublisher({ inner: new InProcessEventPublisher() });
    registerPlaced(outbox);
    uow = unitOfWork(dataSource, outbox);
  });

  afterEach(async () => {
    await dataSource.destroy();
  });

  it('refuses the driver and stores nothing', async () => {
    const run = uow.run(() => uow.getRepository(Order).save(Order.place('o-1')));

    await expect(run).rejects.toBeInstanceOf(UnsupportedDriverError);
    expect(await dataSource.getRepository(Order).count()).toBe(0);
  });

  it('releases every query runner after refusing the driver', async () => {
    await uow.run(() => uow.getRepository(Order).save(Order.place('o-1'))).catch(() => undefined);

    expect(queryRunners.unreleasedCount()).toBe(0);
  });

  it('commits a run that raises no registered event', async () => {
    await uow.run(async () => {
      await uow.getRepository(Order).save(new Order());
    });

    expect(await dataSource.getRepository(Order).count()).toBe(1);
  });
});
