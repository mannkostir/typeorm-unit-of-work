import { setTimeout } from 'node:timers/promises';
import { type DataSource, type EntityManager, QueryFailedError, type QueryRunner } from 'typeorm';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { OpenSavepointAtCommitError } from '../../src/errors/unit-of-work-errors';
import { InProcessEventPublisher } from '../../src/events/in-process-event-publisher';
import { UnitOfWork } from '../../src/unit-of-work';
import { postgres } from './support/databases';
import { closedGate } from './support/gate';
import { Order, OrderPlaced } from './support/model';
import { type QueryRunnerWatch, watchQueryRunners } from './support/query-runner-watch';

describe('transactions on postgres only', () => {
  let dataSource: DataSource;
  let queryRunners: QueryRunnerWatch;
  let uow: UnitOfWork;

  beforeEach(async () => {
    dataSource = await postgres.open();
    queryRunners = watchQueryRunners(dataSource);
    uow = new UnitOfWork({
      dataSource,
      publisher: new InProcessEventPublisher(),
      onAfterCommitError: (error) => {
        throw error;
      },
    });
  });

  afterEach(async () => {
    await dataSource.destroy();
  });

  const idleInTransactionCount = async (): Promise<number> => {
    const [first, second] = [dataSource.createQueryRunner(), dataSource.createQueryRunner()];
    const idleInTransaction = (queryRunner: QueryRunner) =>
      queryRunner.query(
        "select count(*)::int as count from pg_stat_activity where datname = current_database() and state = 'idle in transaction'",
      );
    const counts: readonly { count: number }[][] = await Promise.all([idleInTransaction(first), idleInTransaction(second)]);
    await Promise.all([first.release(), second.release()]);
    return Math.max(...counts.map((rows) => rows[0]?.count ?? 0));
  };

  it('commits a new transaction even when the outer one rolls back', async () => {
    const running = uow.run(async () => {
      await uow.run(
        async () => {
          await uow.getRepository(Order).save(Order.place('o-1'));
        },
        { propagation: 'new' },
      );
      throw new Error('outer failed');
    });

    await expect(running).rejects.toThrow('outer failed');
    expect(await dataSource.getRepository(Order).count()).toBe(1);
  });

  it('restores the outer transaction after a new one finishes', async () => {
    const [outerBefore, outerAfter] = await uow.run(async () => {
      const before = uow.manager;
      await uow.run(async () => undefined, { propagation: 'new' });
      return [before, uow.manager];
    });

    expect(outerAfter).toBe(outerBefore);
  });

  it('applies the requested isolation level', async () => {
    const level = await uow.run(
      async () => {
        const rows: readonly { transaction_isolation: string }[] = await uow.manager.query(
          'SHOW transaction_isolation',
        );
        return rows[0]?.transaction_isolation;
      },
      { isolationLevel: 'SERIALIZABLE' },
    );

    expect(level).toBe('serializable');
  });

  it('keeps concurrent runs in separate transactions', async () => {
    const managersOf = (delay: number) =>
      uow.run(async (context): Promise<readonly EntityManager[]> => {
        await setTimeout(delay);
        return [context.manager, uow.manager];
      });

    const [first, second] = await Promise.all([managersOf(10), managersOf(1)]);

    expect({
      firstConsistent: first?.[0] === first?.[1],
      secondConsistent: second?.[0] === second?.[1],
      separate: first?.[0] !== second?.[0],
    }).toEqual({ firstConsistent: true, secondConsistent: true, separate: true });
  });

  it('commits nothing when a failed statement inside a joined run is caught', async () => {
    await uow.run(async () => {
      await uow.getRepository(Order).save(Order.place('o-1'));
      await expect(uow.run(() => uow.getRepository(Order).insert({ id: 'o-1', status: 'duplicate' }))).rejects.toThrow(
        QueryFailedError,
      );
    });

    expect(await dataSource.getRepository(Order).count()).toBe(0);
  });

  it('releases both query runners of a new transaction nested in another', async () => {
    await uow.run(async () => {
      await uow.run(async () => undefined, { propagation: 'new' });
    });

    expect({
      unreleased: queryRunners.unreleasedCount(),
      releasedInsideTransaction: queryRunners.releasedInsideTransaction(),
    }).toEqual({ unreleased: 0, releasedInsideTransaction: false });
  });

  it('leaves no connection idle in a transaction when starting the transaction fails', async () => {
    const failingSubscriber = {
      afterTransactionStart: () => {
        throw new Error('subscriber failed');
      },
    };
    dataSource.subscribers.push(failingSubscriber);

    const running = uow.run(async () => undefined);
    await expect(running).rejects.toThrow('subscriber failed');
    dataSource.subscribers.pop();

    expect(await idleInTransactionCount()).toBe(0);
  });

  it('leaves no connection idle in a transaction after refusing to commit with a nested run still open', async () => {
    const gate = closedGate();
    const started = closedGate();
    const danglingRuns: Promise<unknown>[] = [];

    const outcome = await uow
      .run(async () => {
        danglingRuns.push(
          uow
            .run(
              async () => {
                started.open();
                await gate.opened;
              },
              { propagation: 'nested' },
            )
            .catch((error: unknown) => error),
        );
        await started.opened;
      })
      .catch((error: unknown) => error);
    gate.open();
    await Promise.all(danglingRuns);

    expect({ refused: outcome instanceof OpenSavepointAtCommitError, idle: await idleInTransactionCount() }).toEqual({
      refused: true,
      idle: 0,
    });
  });

  it('runs after-commit handlers of a new transaction outside the outer one', async () => {
    const publisher = new InProcessEventPublisher();
    const seen: { handler?: EntityManager } = {};
    const eventful = new UnitOfWork({
      dataSource,
      publisher,
      onAfterCommitError: (error) => {
        throw error;
      },
    });
    publisher.onAfterCommit(OrderPlaced, () => {
      seen.handler = eventful.manager;
    });

    await eventful.run(async () => {
      await eventful.run(
        async () => {
          const order = Order.place('o-1');
          await eventful.getRepository(Order).save(order);
          eventful.track(order);
        },
        { propagation: 'new' },
      );
    });

    expect(seen.handler).toBe(dataSource.manager);
  });
});
