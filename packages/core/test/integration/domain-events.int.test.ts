import type { DataSource, EntityManager } from 'typeorm';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { EventCascadeLimitExceededError, ScopeNotActiveError } from '../../src/errors/unit-of-work-errors';
import { InProcessEventPublisher } from '../../src/events/in-process-event-publisher';
import { UnitOfWork } from '../../src/unit-of-work';
import type { UnitOfWorkOptions } from '../../src/unit-of-work-options';
import { databases } from './support/databases';
import { AuditEntry, Order, OrderPlaced, OrderShipped } from './support/model';

describe.each(databases)('domain events on $name', (database) => {
  let dataSource: DataSource;
  let publisher: InProcessEventPublisher;
  let afterCommitErrors: unknown[];
  let uow: UnitOfWork;

  const unitOfWork = (overrides: Partial<UnitOfWorkOptions> = {}) =>
    new UnitOfWork({
      dataSource,
      publisher,
      onAfterCommitError: (error) => {
        afterCommitErrors.push(error);
      },
      ...overrides,
    });

  const placeTrackedOrder = async (id: string): Promise<Order> => {
    const order = Order.place(id);
    await uow.getRepository(Order).save(order);
    uow.track(order);
    return order;
  };

  beforeEach(async () => {
    dataSource = await database.open();
    publisher = new InProcessEventPublisher();
    afterCommitErrors = [];
    uow = unitOfWork();
  });

  afterEach(async () => {
    await dataSource.destroy();
  });

  it('publishes tracked events after commit', async () => {
    const published: object[] = [];
    publisher.onAfterCommit(OrderPlaced, (event) => {
      published.push(event);
    });

    await uow.run(() => placeTrackedOrder('o-1'));

    expect(published).toEqual([new OrderPlaced('o-1')]);
  });

  it('publishes nothing after commit when the work throws', async () => {
    const published: object[] = [];
    publisher.onAfterCommit(OrderPlaced, (event) => {
      published.push(event);
    });

    await uow
      .run(async () => {
        await placeTrackedOrder('o-1');
        throw new Error('declined');
      })
      .catch(() => undefined);

    expect(published).toEqual([]);
  });

  it('discards pending events when commitWhen rejects the result', async () => {
    const order = await uow.run(() => placeTrackedOrder('o-1'), { commitWhen: () => false });

    expect(order.pullDomainEvents()).toEqual([]);
  });

  it('commits what before-commit handlers write', async () => {
    publisher.onBeforeCommit(OrderPlaced, async (event, context) => {
      await context.getRepository(AuditEntry).save({ message: `placed ${event.orderId}` });
    });

    await uow.run(() => placeTrackedOrder('o-1'));

    expect(await dataSource.getRepository(AuditEntry).find()).toMatchObject([{ message: 'placed o-1' }]);
  });

  it('rolls back the work and handler writes when a before-commit handler fails', async () => {
    const failure = new Error('stock check failed');
    publisher.onBeforeCommit(OrderPlaced, async (_event, context) => {
      await context.getRepository(AuditEntry).save({ message: 'written before failure' });
    });
    publisher.onBeforeCommit(OrderPlaced, () => {
      throw failure;
    });

    await expect(uow.run(() => placeTrackedOrder('o-1'))).rejects.toBe(failure);
    expect({
      orders: await dataSource.getRepository(Order).count(),
      audits: await dataSource.getRepository(AuditEntry).count(),
    }).toEqual({ orders: 0, audits: 0 });
  });

  it('lets before-commit handlers use the unit of work inside the same transaction', async () => {
    const seen: { handler?: EntityManager } = {};
    publisher.onBeforeCommit(OrderPlaced, async () => {
      seen.handler = await uow.run(async () => uow.manager);
    });

    const workManager = await uow.run(async () => {
      await placeTrackedOrder('o-1');
      return uow.manager;
    });

    expect(seen.handler).toBe(workManager);
  });

  it('publishes events raised by before-commit handlers after commit, in order', async () => {
    const published: object[] = [];
    publisher.onBeforeCommit(OrderPlaced, async (event) => {
      const order = await uow.getRepository(Order).findOneByOrFail({ id: event.orderId });
      order.ship();
      await uow.getRepository(Order).save(order);
      uow.track(order);
    });
    publisher.onAfterCommit(OrderPlaced, (event) => {
      published.push(event);
    });
    publisher.onAfterCommit(OrderShipped, (event) => {
      published.push(event);
    });

    await uow.run(() => placeTrackedOrder('o-1'));

    expect(published).toEqual([new OrderPlaced('o-1'), new OrderShipped('o-1')]);
  });

  it('rolls back when before-commit handlers exceed the round limit', async () => {
    const limited = unitOfWork({ maxEventRounds: 1 });
    publisher.onBeforeCommit(OrderPlaced, async (event) => {
      const order = await limited.getRepository(Order).findOneByOrFail({ id: event.orderId });
      order.ship();
      limited.track(order);
    });

    const running = limited.run(async () => {
      const order = Order.place('o-1');
      await limited.getRepository(Order).save(order);
      limited.track(order);
    });

    await expect(running).rejects.toBeInstanceOf(EventCascadeLimitExceededError);
    expect(await dataSource.getRepository(Order).count()).toBe(0);
  });

  it('reports a failing after-commit handler, runs the rest, and resolves', async () => {
    const failure = new Error('mailer down');
    const published: object[] = [];
    publisher.onAfterCommit(OrderPlaced, () => {
      throw failure;
    });
    publisher.onAfterCommit(OrderPlaced, (event) => {
      published.push(event);
    });

    const result = await uow.run(async () => {
      await placeTrackedOrder('o-1');
      return 'committed';
    });

    expect({ result, afterCommitErrors, published }).toEqual({
      result: 'committed',
      afterCommitErrors: [failure],
      published: [new OrderPlaced('o-1')],
    });
  });

  it('rejects with the error thrown by onAfterCommitError and keeps the data committed', async () => {
    const reporterFailure = new Error('reporter crashed');
    const crashingReporter = unitOfWork({
      onAfterCommitError: () => {
        throw reporterFailure;
      },
    });
    publisher.onAfterCommit(OrderPlaced, () => {
      throw new Error('mailer down');
    });

    const running = crashingReporter.run(async () => {
      const order = Order.place('o-1');
      await crashingReporter.getRepository(Order).save(order);
      crashingReporter.track(order);
    });

    await expect(running).rejects.toBe(reporterFailure);
    expect(await dataSource.getRepository(Order).count()).toBe(1);
  });

  it('runs after-commit handlers outside any transaction', async () => {
    const seen: { handler?: EntityManager } = {};
    publisher.onAfterCommit(OrderPlaced, () => {
      seen.handler = uow.manager;
    });

    await uow.run(() => placeTrackedOrder('o-1'));

    expect(seen.handler).toBe(dataSource.manager);
  });

  it('refuses to track outside a run', () => {
    expect(() => uow.track(Order.place('o-1'))).toThrow(ScopeNotActiveError);
  });
});
