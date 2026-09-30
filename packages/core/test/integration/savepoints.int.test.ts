import type { DataSource } from 'typeorm';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { InProcessEventPublisher } from '../../src/events/in-process-event-publisher';
import { UnitOfWork } from '../../src/unit-of-work';
import { databases } from './support/databases';
import { Order, OrderPlaced, OrderShipped } from './support/model';
import { type QueryRunnerWatch, watchQueryRunners } from './support/query-runner-watch';

describe.each(databases)('nested savepoints on $name', (database) => {
  let dataSource: DataSource;
  let queryRunners: QueryRunnerWatch;
  let published: object[];
  let uow: UnitOfWork;

  const storedIds = async () =>
    (await dataSource.getRepository(Order).find({ order: { id: 'ASC' } })).map((order) => order.id);

  const place = (id: string) => uow.getRepository(Order).save(Order.place(id));

  const failNested = (work: () => Promise<unknown>) =>
    uow
      .run(
        async () => {
          await work();
          throw new Error('nested failed');
        },
        { propagation: 'nested' },
      )
      .catch(() => undefined);

  beforeEach(async () => {
    dataSource = await database.open();
    queryRunners = watchQueryRunners(dataSource);
    published = [];
    const publisher = new InProcessEventPublisher();
    publisher.onAfterCommit(OrderPlaced, (event) => {
      published.push(event);
    });
    publisher.onAfterCommit(OrderShipped, (event) => {
      published.push(event);
    });
    uow = new UnitOfWork({
      dataSource,
      publisher,
      onAfterCommitError: (error) => {
        throw error;
      },
    });
  });

  afterEach(async () => {
    await dataSource.destroy();
  });

  it('commits nested work with the outer transaction and publishes its events after the outer commit', async () => {
    await uow.run(async () => {
      await place('o-1');
      await uow.run(() => place('o-2'), { propagation: 'nested' });
    });

    expect({ stored: await storedIds(), published }).toEqual({
      stored: ['o-1', 'o-2'],
      published: [new OrderPlaced('o-1'), new OrderPlaced('o-2')],
    });
  });

  it('keeps outer work and drops nested work and events when the savepoint rolls back', async () => {
    await uow.run(async () => {
      await place('o-1');
      await failNested(() => place('o-2'));
    });

    expect({ stored: await storedIds(), published }).toEqual({
      stored: ['o-1'],
      published: [new OrderPlaced('o-1')],
    });
  });

  it('keeps events raised before the savepoint on an aggregate touched inside it', async () => {
    await uow.run(async () => {
      const order = Order.place('o-1');
      await uow.getRepository(Order).save(order);
      await failNested(async () => {
        order.ship();
        await uow.getRepository(Order).save(order);
      });
    });

    expect(published).toEqual([new OrderPlaced('o-1')]);
  });

  it('recovers the outer transaction after a failed statement inside the savepoint', async () => {
    await uow.run(async () => {
      await place('o-1');
      await uow
        .run(() => uow.getRepository(Order).insert({ id: 'o-1', status: 'duplicate' }), { propagation: 'nested' })
        .catch(() => undefined);
      await place('o-2');
    });

    expect(await storedIds()).toEqual(['o-1', 'o-2']);
  });

  it('rolls back to the savepoint and returns the result when commitWhen rejects it', async () => {
    const result = await uow.run(async () => {
      await place('o-1');
      return uow.run(
        async () => {
          await place('o-2');
          return 'rejected';
        },
        { propagation: 'nested', commitWhen: (outcome) => outcome !== 'rejected' },
      );
    });

    expect({ result, stored: await storedIds() }).toEqual({ result: 'rejected', stored: ['o-1'] });
  });

  it('keeps a committed middle savepoint when an inner one rolls back', async () => {
    await uow.run(async () => {
      await uow.run(
        async () => {
          await place('o-1');
          await failNested(() => place('o-2'));
        },
        { propagation: 'nested' },
      );
    });

    expect(await storedIds()).toEqual(['o-1']);
  });

  it('opens a transaction of its own when there is no outer one', async () => {
    await uow.run(() => place('o-1'), { propagation: 'nested' });

    expect({ stored: await storedIds(), published }).toEqual({
      stored: ['o-1'],
      published: [new OrderPlaced('o-1')],
    });
  });

  it('collects saves after the savepoint into the outer transaction again', async () => {
    await uow.run(async () => {
      await failNested(() => place('o-1'));
      await place('o-2');
    });

    expect(published).toEqual([new OrderPlaced('o-2')]);
  });

  it('releases every query runner', async () => {
    await uow.run(async () => {
      await failNested(() => place('o-1'));
    });

    expect(queryRunners.unreleasedCount()).toBe(0);
  });
});
