import type { DataSource } from 'typeorm';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { InvalidUnitOfWorkOptionsError, ScopeNotActiveError } from '../../src/errors/unit-of-work-errors';
import { InProcessEventPublisher } from '../../src/events/in-process-event-publisher';
import { UnitOfWork } from '../../src/unit-of-work';
import { databases } from './support/databases';
import { Order } from './support/model';
import { type QueryRunnerWatch, watchQueryRunners } from './support/query-runner-watch';

const failOnAfterCommitError = (error: unknown): never => {
  throw error;
};

describe.each(databases)('transactions on $name', (database) => {
  let dataSource: DataSource;
  let queryRunners: QueryRunnerWatch;
  let uow: UnitOfWork;

  const storedOrders = () => dataSource.getRepository(Order).count();

  beforeEach(async () => {
    dataSource = await database.open();
    queryRunners = watchQueryRunners(dataSource);
    uow = new UnitOfWork({
      dataSource,
      publisher: new InProcessEventPublisher(),
      onAfterCommitError: failOnAfterCommitError,
    });
  });

  afterEach(async () => {
    await dataSource.destroy();
  });

  it('commits the work', async () => {
    await uow.run(async () => {
      await uow.getRepository(Order).save(Order.place('o-1'));
    });

    expect(await storedOrders()).toBe(1);
  });

  it('returns what the work returns', async () => {
    expect(await uow.run(async () => 'done')).toBe('done');
  });

  it('rolls back and rethrows when the work throws', async () => {
    const failure = new Error('payment declined');

    const running = uow.run(async () => {
      await uow.getRepository(Order).save(Order.place('o-1'));
      throw failure;
    });

    await expect(running).rejects.toBe(failure);
    expect(await storedOrders()).toBe(0);
  });

  it('rolls back and returns the result when commitWhen rejects it', async () => {
    const result = await uow.run(
      async () => {
        await uow.getRepository(Order).save(Order.place('o-1'));
        return 'rejected';
      },
      { commitWhen: (outcome) => outcome !== 'rejected' },
    );

    expect({ result, stored: await storedOrders() }).toEqual({ result: 'rejected', stored: 0 });
  });

  it('gives the work the same manager as uow.manager', async () => {
    const [contextManager, ambientManager] = await uow.run(async (context) => [context.manager, uow.manager]);

    expect(contextManager).toBe(ambientManager);
  });

  it('uses a transactional manager inside a run', async () => {
    const manager = await uow.run(async () => uow.manager);

    expect(manager).not.toBe(dataSource.manager);
  });

  it('falls back to the DataSource manager outside a run', () => {
    expect(uow.manager).toBe(dataSource.manager);
  });

  it('throws outside a run when strict', () => {
    const strictUow = new UnitOfWork({
      dataSource,
      publisher: new InProcessEventPublisher(),
      onAfterCommitError: failOnAfterCommitError,
      strict: true,
    });

    expect(() => strictUow.manager).toThrow(ScopeNotActiveError);
  });

  it('joins the outer transaction by default', async () => {
    const running = uow.run(async () => {
      await uow.run(async () => {
        await uow.getRepository(Order).save(Order.place('o-1'));
      });
      throw new Error('outer failed');
    });

    await expect(running).rejects.toThrow('outer failed');
    expect(await storedOrders()).toBe(0);
  });

  it('commits the outer transaction when a joined failure is caught', async () => {
    await uow.run(async () => {
      await uow.getRepository(Order).save(Order.place('o-1'));
      await uow
        .run(async () => {
          throw new Error('inner failed');
        })
        .catch(() => undefined);
    });

    expect(await storedOrders()).toBe(1);
  });

  it('releases every query runner after success and failure', async () => {
    await uow.run(async () => undefined);
    await uow
      .run(async () => {
        throw new Error('failed');
      })
      .catch(() => undefined);

    expect({
      unreleased: queryRunners.unreleasedCount(),
      releasedInsideTransaction: queryRunners.releasedInsideTransaction(),
    }).toEqual({ unreleased: 0, releasedInsideTransaction: false });
  });

  it('rejects an unknown propagation without opening a transaction', async () => {
    const running = uow.run(async () => undefined, { propagation: 'required' as never });

    await expect(running).rejects.toBeInstanceOf(InvalidUnitOfWorkOptionsError);
    expect(dataSource.createQueryRunner).not.toHaveBeenCalled();
  });
});
