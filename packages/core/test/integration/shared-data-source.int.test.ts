import type { DataSource } from 'typeorm';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { InProcessEventPublisher } from '../../src/events/in-process-event-publisher';
import { UnitOfWork } from '../../src/unit-of-work';
import { databases } from './support/databases';
import { Order, OrderPlaced } from './support/model';
import { type QueryRunnerWatch, watchQueryRunners } from './support/query-runner-watch';

describe.each(databases)('units of work sharing a data source on $name', (database) => {
  let dataSource: DataSource;
  let queryRunners: QueryRunnerWatch;
  let firstPublished: object[];
  let secondPublished: object[];
  let first: UnitOfWork;
  let second: UnitOfWork;

  const newUnitOfWork = (published: object[]) => {
    const publisher = new InProcessEventPublisher();
    publisher.onAfterCommit(OrderPlaced, (event) => {
      published.push(event);
    });
    return new UnitOfWork({
      dataSource,
      publisher,
      onAfterCommitError: (error) => {
        throw error;
      },
    });
  };

  const placeOrder = (uow: UnitOfWork, id: string) => uow.getRepository(Order).save(Order.place(id));

  beforeEach(async () => {
    dataSource = await database.open();
    queryRunners = watchQueryRunners(dataSource);
    firstPublished = [];
    secondPublished = [];
    first = newUnitOfWork(firstPublished);
    second = newUnitOfWork(secondPublished);
  });

  afterEach(async () => {
    await dataSource.destroy();
  });

  it('publishes an event raised in one unit of work exactly once across both publishers', async () => {
    await first.run(() => placeOrder(first, 'o-1'));

    expect({ first: firstPublished, second: secondPublished }).toEqual({
      first: [new OrderPlaced('o-1')],
      second: [],
    });
  });

  it("commits both runs and routes each run's events to its own publisher", async () => {
    await first.run(() => placeOrder(first, 'o-1'));
    await second.run(() => placeOrder(second, 'o-2'));

    expect({
      first: firstPublished,
      second: secondPublished,
      orders: await dataSource.getRepository(Order).count(),
    }).toEqual({
      first: [new OrderPlaced('o-1')],
      second: [new OrderPlaced('o-2')],
      orders: 2,
    });
  });

  it('rolls back only the failing run and keeps the other committed write', async () => {
    await first.run(() => placeOrder(first, 'o-1'));
    await second
      .run(async () => {
        await placeOrder(second, 'o-2');
        throw new Error('declined');
      })
      .catch(() => undefined);

    expect(await dataSource.getRepository(Order).find()).toMatchObject([{ id: 'o-1' }]);
  });

  it('publishes nothing from the failing run', async () => {
    await second
      .run(async () => {
        await placeOrder(second, 'o-2');
        throw new Error('declined');
      })
      .catch(() => undefined);

    expect({ first: firstPublished, second: secondPublished }).toEqual({ first: [], second: [] });
  });

  it('releases every query runner after both runs', async () => {
    await first.run(() => placeOrder(first, 'o-1'));
    await second
      .run(async () => {
        await placeOrder(second, 'o-2');
        throw new Error('declined');
      })
      .catch(() => undefined);

    expect({
      unreleased: queryRunners.unreleasedCount(),
      releasedInsideTransaction: queryRunners.releasedInsideTransaction(),
    }).toEqual({ unreleased: 0, releasedInsideTransaction: false });
  });
});
