import type { DataSource } from 'typeorm';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { InProcessEventPublisher } from '../../src/events/in-process-event-publisher';
import { UnitOfWork } from '../../src/unit-of-work';
import { databases } from './support/databases';
import { Order, OrderCancelled, OrderPlaced, OrderShipped } from './support/model';

describe.each(databases)('automatic event collection on $name', (database) => {
  let dataSource: DataSource;
  let published: object[];
  let uow: UnitOfWork;

  const newUnitOfWork = () => {
    const publisher = new InProcessEventPublisher();
    publisher.onAfterCommit(OrderPlaced, (event) => {
      published.push(event);
    });
    publisher.onAfterCommit(OrderShipped, (event) => {
      published.push(event);
    });
    publisher.onAfterCommit(OrderCancelled, (event) => {
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

  beforeEach(async () => {
    dataSource = await database.open();
    published = [];
    uow = newUnitOfWork();
  });

  afterEach(async () => {
    await dataSource.destroy();
  });

  it('collects events of aggregates inserted through a repository', async () => {
    await uow.run(async () => {
      await uow.getRepository(Order).save(Order.place('o-1'));
    });

    expect(published).toEqual([new OrderPlaced('o-1')]);
  });

  it('collects events of aggregates saved through the transaction manager', async () => {
    await uow.run(async (context) => {
      await context.manager.save(Order.place('o-1'));
    });

    expect(published).toEqual([new OrderPlaced('o-1')]);
  });

  it('collects events of aggregates loaded from the database and updated', async () => {
    await uow.run(async () => {
      await uow.getRepository(Order).save(Order.place('o-1'));
    });
    published = [];

    await uow.run(async () => {
      const order = await uow.getRepository(Order).findOneByOrFail({ id: 'o-1' });
      order.ship();
      await uow.getRepository(Order).save(order);
    });

    expect(published).toEqual([new OrderShipped('o-1')]);
  });

  it('collects events of removed aggregates', async () => {
    await uow.run(async () => {
      await uow.getRepository(Order).save(Order.place('o-1'));
    });
    published = [];

    await uow.run(async () => {
      const order = await uow.getRepository(Order).findOneByOrFail({ id: 'o-1' });
      order.cancel();
      await uow.getRepository(Order).remove(order);
    });

    expect(published).toEqual([new OrderCancelled('o-1')]);
  });

  it('collects events of soft-removed aggregates', async () => {
    await uow.run(async () => {
      await uow.getRepository(Order).save(Order.place('o-1'));
    });
    published = [];

    await uow.run(async () => {
      const order = await uow.getRepository(Order).findOneByOrFail({ id: 'o-1' });
      order.cancel();
      await uow.getRepository(Order).softRemove(order);
    });

    expect(published).toEqual([new OrderCancelled('o-1')]);
  });

  it('does not collect from query-builder updates', async () => {
    await uow.run(async () => {
      await uow.getRepository(Order).save(Order.place('o-1'));
    });
    published = [];

    const order = await uow.run(async () => {
      const loaded = await uow.getRepository(Order).findOneByOrFail({ id: 'o-1' });
      loaded.ship();
      await uow.manager
        .createQueryBuilder()
        .update(Order)
        .set({ status: 'shipped' })
        .where('id = :id', { id: 'o-1' })
        .execute();
      return loaded;
    });

    expect({ published, stillPending: order.pullDomainEvents() }).toEqual({
      published: [],
      stillPending: [new OrderShipped('o-1')],
    });
  });

  it('ignores saves outside a run and leaves their events pending', async () => {
    const order = Order.place('o-1');

    await dataSource.getRepository(Order).save(order);

    expect({ published, stillPending: order.pullDomainEvents() }).toEqual({
      published: [],
      stillPending: [new OrderPlaced('o-1')],
    });
  });

  it('registers one subscriber per DataSource however many units of work use it', () => {
    const subscribersWithOne = dataSource.subscribers.length;

    newUnitOfWork();

    expect(dataSource.subscribers.length).toBe(subscribersWithOne);
  });
});
