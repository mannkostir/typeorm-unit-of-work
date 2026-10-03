import type { DataSource } from 'typeorm';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { TransactionRollbackError } from '../../src/errors/unit-of-work-errors';
import { InProcessEventPublisher } from '../../src/events/in-process-event-publisher';
import { UnitOfWork } from '../../src/unit-of-work';
import type { ConnectionDiscard } from '../../src/unit-of-work-options';
import { postgres, postgresWithOneConnection } from './support/databases';
import { Order } from './support/model';
import { type QueryRunnerWatch, watchQueryRunners } from './support/query-runner-watch';

const terminateBackend: ConnectionDiscard = async (queryRunner) => {
  const connection = await queryRunner.connect();
  const closed = new Promise((resolve) => connection.once('end', resolve));
  await queryRunner.query('ROLLBACK').catch(() => undefined);
  try {
    await queryRunner.query('SELECT pg_terminate_backend(pg_backend_pid())');
  } catch (error) {
    if (error instanceof Error && 'code' in error && error.code === '57P01') {
      await closed;
      return;
    }
    throw error;
  }
  throw new Error('The backend was not terminated');
};

describe('discarding a poisoned postgres connection', () => {
  let dataSource: DataSource;
  let queryRunners: QueryRunnerWatch;

  const unitOfWork = (discardConnection?: ConnectionDiscard) =>
    new UnitOfWork({
      dataSource,
      publisher: new InProcessEventPublisher(),
      onAfterCommitError: (error) => {
        throw error;
      },
      ...(discardConnection && { discardConnection }),
    });

  const runThatCannotRollBack = (uow: UnitOfWork) =>
    uow.run(async () => {
      await uow.run(
        async () => {
          await uow.manager.query('RELEASE SAVEPOINT typeorm_1');
          throw new Error('work failed');
        },
        { propagation: 'nested' },
      );
    });

  const backendPid = (uow: UnitOfWork) =>
    uow.run(async () => {
      const rows: readonly { pid: number }[] = await uow.manager.query('SELECT pg_backend_pid() AS pid');
      return rows[0]?.pid;
    });

  beforeEach(async () => {
    dataSource = await postgresWithOneConnection.open();
    queryRunners = watchQueryRunners(dataSource);
  });

  afterEach(async () => {
    await dataSource.destroy();
  });

  it('rejects with the rollback failure when a savepoint cannot be rolled back', async () => {
    const running = runThatCannotRollBack(unitOfWork(terminateBackend));

    await expect(running).rejects.toBeInstanceOf(TransactionRollbackError);
  });

  it('hands the aborted transaction to the next run when the connection is not discarded', async () => {
    const uow = unitOfWork();
    await runThatCannotRollBack(uow).catch(() => undefined);

    const next = uow.run(() => uow.getRepository(Order).save(Order.place('o-1')));

    await expect(next).rejects.toThrow('current transaction is aborted');
  });

  it('gives the next run a fresh connection once the poisoned one is terminated', async () => {
    const uow = unitOfWork(terminateBackend);
    const poisonedPid = await backendPid(uow);
    await runThatCannotRollBack(uow).catch(() => undefined);

    const nextPid = await backendPid(uow);

    expect(nextPid).not.toBe(poisonedPid);
  });

  it('stores the next run once the poisoned connection is terminated', async () => {
    const uow = unitOfWork(terminateBackend);
    await runThatCannotRollBack(uow).catch(() => undefined);

    await uow.run(() => uow.getRepository(Order).save(Order.place('o-1')));

    expect({
      stored: await dataSource.getRepository(Order).count(),
      unreleased: queryRunners.unreleasedCount(),
    }).toEqual({ stored: 1, unreleased: 0 });
  });
});

describe('discarding a connection inside a new run on postgres', () => {
  let dataSource: DataSource;
  let discarded: number;

  beforeEach(async () => {
    dataSource = await postgres.open();
    discarded = 0;
  });

  afterEach(async () => {
    await dataSource.destroy();
  });

  it('discards only the inner connection, and the outer run commits', async () => {
    const uow = new UnitOfWork({
      dataSource,
      publisher: new InProcessEventPublisher(),
      onAfterCommitError: (error) => {
        throw error;
      },
      discardConnection: async () => {
        discarded += 1;
      },
    });

    await uow.run(async () => {
      await uow.getRepository(Order).save(Order.place('o-outer'));
      await uow
        .run(
          () =>
            uow.run(
              async () => {
                await uow.manager.query('RELEASE SAVEPOINT typeorm_1');
                throw new Error('inner failed');
              },
              { propagation: 'nested' },
            ),
          { propagation: 'new' },
        )
        .catch(() => undefined);
    });

    expect({ discarded, stored: await dataSource.getRepository(Order).count() }).toEqual({ discarded: 1, stored: 1 });
  });
});
