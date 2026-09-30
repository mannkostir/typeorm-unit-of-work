import type { DataSource } from 'typeorm';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { TransactionRollbackError } from '../../src/errors/unit-of-work-errors';
import { InProcessEventPublisher } from '../../src/events/in-process-event-publisher';
import { UnitOfWork } from '../../src/unit-of-work';
import { databases } from './support/databases';
import { Order, OrderPlaced } from './support/model';
import { type QueryRunnerWatch, watchQueryRunners } from './support/query-runner-watch';

describe.each(databases)('abandoned transactions on $name', (database) => {
  let dataSource: DataSource;
  let queryRunners: QueryRunnerWatch;
  let published: object[];
  let uow: UnitOfWork;

  const storedIds = async () =>
    (await dataSource.getRepository(Order).find({ order: { id: 'ASC' } })).map((order) => order.id);

  const place = (id: string) => uow.getRepository(Order).save(Order.place(id));

  const throwingCommitWhen = (failure: Error) => (): boolean => {
    throw failure;
  };

  const rollbackFailingOnce = () => {
    const state = { failed: false };
    return {
      beforeTransactionRollback: () => {
        if (!state.failed) {
          state.failed = true;
          throw new Error('rollback failed');
        }
      },
    };
  };

  beforeEach(async () => {
    dataSource = await database.open();
    queryRunners = watchQueryRunners(dataSource);
    published = [];
    const publisher = new InProcessEventPublisher();
    publisher.onAfterCommit(OrderPlaced, (event) => {
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

  it('rejects a root run with the error its commitWhen throws', async () => {
    const failure = new Error('commitWhen failed');

    const running = uow.run(() => place('o-1'), { commitWhen: throwingCommitWhen(failure) });

    await expect(running).rejects.toBe(failure);
  });

  it('rolls back a root run whose commitWhen throws and leaves later runs unaffected', async () => {
    await uow.run(() => place('o-1'), { commitWhen: throwingCommitWhen(new Error('commitWhen failed')) }).catch(
      () => undefined,
    );

    await uow.run(() => place('o-2'));

    expect({
      stored: await storedIds(),
      published,
      releasedInsideTransaction: queryRunners.releasedInsideTransaction(),
    }).toEqual({ stored: ['o-2'], published: [new OrderPlaced('o-2')], releasedInsideTransaction: false });
  });

  it('discards the pending events of a root run whose commitWhen throws', async () => {
    const order = Order.place('o-1');

    await uow
      .run(() => uow.getRepository(Order).save(order), { commitWhen: throwingCommitWhen(new Error('commitWhen failed')) })
      .catch(() => undefined);

    expect(order.pullDomainEvents()).toEqual([]);
  });

  it('rejects a nested run with the error its commitWhen throws', async () => {
    const failure = new Error('commitWhen failed');

    const outcome = await uow.run(() =>
      uow
        .run(() => place('o-1'), { propagation: 'nested', commitWhen: throwingCommitWhen(failure) })
        .catch((error: unknown) => error),
    );

    expect(outcome).toBe(failure);
  });

  it('rolls back a nested run whose commitWhen throws and commits the rest of the outer work', async () => {
    await uow.run(async () => {
      await place('o-1');
      await uow
        .run(() => place('o-2'), { propagation: 'nested', commitWhen: throwingCommitWhen(new Error('commitWhen failed')) })
        .catch(() => undefined);
      await place('o-3');
    });

    await uow.run(() => place('o-4'));

    expect({
      stored: await storedIds(),
      published,
      releasedInsideTransaction: queryRunners.releasedInsideTransaction(),
    }).toEqual({
      stored: ['o-1', 'o-3', 'o-4'],
      published: [new OrderPlaced('o-1'), new OrderPlaced('o-3'), new OrderPlaced('o-4')],
      releasedInsideTransaction: false,
    });
  });

  it('rolls back before releasing a query runner whose rollback failed', async () => {
    dataSource.subscribers.push(rollbackFailingOnce());

    const running = uow.run(async () => {
      await place('o-1');
      throw new Error('work failed');
    });
    await expect(running).rejects.toBeInstanceOf(TransactionRollbackError);
    dataSource.subscribers.pop();

    await uow.run(() => place('o-2'));

    expect({ stored: await storedIds(), releasedInsideTransaction: queryRunners.releasedInsideTransaction() }).toEqual({
      stored: ['o-2'],
      releasedInsideTransaction: false,
    });
  });
});
