import type { DataSource, QueryRunner } from 'typeorm';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { TransactionRollbackError } from '../../src/errors/unit-of-work-errors';
import { InProcessEventPublisher } from '../../src/events/in-process-event-publisher';
import { UnitOfWork } from '../../src/unit-of-work';
import type { ConnectionDiscard } from '../../src/unit-of-work-options';
import { databases } from './support/databases';
import { Order } from './support/model';
import { type QueryRunnerWatch, watchQueryRunners } from './support/query-runner-watch';

interface DiscardCall {
  readonly queryRunner: QueryRunner;
  readonly failure: TransactionRollbackError;
}

describe.each(databases)('discarding the connection after a failed rollback on $name', (database) => {
  let dataSource: DataSource;
  let queryRunners: QueryRunnerWatch;
  let discarded: DiscardCall[];

  const recordDiscard: ConnectionDiscard = async (queryRunner, failure) => {
    discarded.push({ queryRunner, failure });
  };

  const unitOfWork = (discardConnection?: ConnectionDiscard) =>
    new UnitOfWork({
      dataSource,
      publisher: new InProcessEventPublisher(),
      onAfterCommitError: (error) => {
        throw error;
      },
      ...(discardConnection && { discardConnection }),
    });

  const rollbackAlwaysFailing = () => ({
    beforeTransactionRollback: () => {
      throw new Error('rollback failed');
    },
  });

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

  const leftoverRollbackFailingAfterItCompletes = () => ({
    ...rollbackFailingOnce(),
    afterTransactionRollback: () => {
      throw new Error('after rollback failed');
    },
  });

  const failingRun = (uow: UnitOfWork, failure: Error) =>
    uow.run(async () => {
      await uow.getRepository(Order).save(Order.place('o-1'));
      throw failure;
    });

  beforeEach(async () => {
    dataSource = await database.open();
    queryRunners = watchQueryRunners(dataSource);
    discarded = [];
  });

  afterEach(async () => {
    dataSource.subscribers.splice(0, dataSource.subscribers.length);
    await dataSource.destroy();
  });

  it('hands the query runner and the rollback failure to discardConnection', async () => {
    dataSource.subscribers.push(rollbackAlwaysFailing());

    const outcome = await failingRun(unitOfWork(recordDiscard), new Error('work failed')).catch((error: unknown) => error);

    expect(discarded).toEqual([{ queryRunner: expect.anything(), failure: outcome }]);
  });

  it('rejects with the rollback failure when discardConnection resolves', async () => {
    dataSource.subscribers.push(rollbackAlwaysFailing());

    const running = failingRun(unitOfWork(recordDiscard), new Error('work failed'));

    await expect(running).rejects.toBeInstanceOf(TransactionRollbackError);
  });

  it('passes the error the work threw as the root cause of the rollback failure', async () => {
    const workFailure = new Error('work failed');
    dataSource.subscribers.push(rollbackAlwaysFailing());

    await failingRun(unitOfWork(recordDiscard), workFailure).catch(() => undefined);

    expect(discarded[0]?.failure).toMatchObject({ originalError: { originalError: workFailure } });
  });

  it('releases the query runner after discardConnection', async () => {
    dataSource.subscribers.push(rollbackAlwaysFailing());

    await failingRun(unitOfWork(recordDiscard), new Error('work failed')).catch(() => undefined);

    expect(queryRunners.unreleasedCount()).toBe(0);
  });

  it('does not discard a connection whose rollback succeeded', async () => {
    await failingRun(unitOfWork(recordDiscard), new Error('work failed')).catch(() => undefined);

    expect(discarded).toEqual([]);
  });

  it('does not discard a connection whose leftover rollback succeeded after an earlier one failed', async () => {
    dataSource.subscribers.push(rollbackFailingOnce());

    await failingRun(unitOfWork(recordDiscard), new Error('work failed')).catch(() => undefined);

    expect(discarded).toEqual([]);
  });

  it('does not discard a connection whose rollback completed before an afterTransactionRollback subscriber failed', async () => {
    dataSource.subscribers.push(leftoverRollbackFailingAfterItCompletes());

    await failingRun(unitOfWork(recordDiscard), new Error('work failed')).catch(() => undefined);

    expect(discarded).toEqual([]);
  });

  it('still rejects with the rollback failure when an afterTransactionRollback subscriber fails', async () => {
    dataSource.subscribers.push(leftoverRollbackFailingAfterItCompletes());

    const running = failingRun(unitOfWork(recordDiscard), new Error('work failed'));

    await expect(running).rejects.toBeInstanceOf(TransactionRollbackError);
  });

  it('still rejects with the rollback failure and releases the runner without discardConnection', async () => {
    dataSource.subscribers.push(rollbackAlwaysFailing());

    const outcome = await failingRun(unitOfWork(), new Error('work failed')).catch((error: unknown) => error);

    expect({
      rejectedWithRollbackFailure: outcome instanceof TransactionRollbackError,
      unreleased: queryRunners.unreleasedCount(),
    }).toEqual({ rejectedWithRollbackFailure: true, unreleased: 0 });
  });

  it('rejects with ConnectionDiscardError carrying both errors when discardConnection fails', async () => {
    const discardError = new Error('terminate failed');
    dataSource.subscribers.push(rollbackAlwaysFailing());
    const failingDiscard: ConnectionDiscard = async () => {
      throw discardError;
    };

    const outcome = await failingRun(unitOfWork(failingDiscard), new Error('work failed')).catch(
      (error: unknown) => error,
    );

    expect(outcome).toMatchObject({
      name: 'ConnectionDiscardError',
      rollbackFailure: { name: 'TransactionRollbackError' },
      cause: discardError,
    });
  });

  it('releases the query runner when discardConnection fails', async () => {
    dataSource.subscribers.push(rollbackAlwaysFailing());
    const failingDiscard: ConnectionDiscard = async () => {
      throw new Error('terminate failed');
    };

    await failingRun(unitOfWork(failingDiscard), new Error('work failed')).catch(() => undefined);

    expect(queryRunners.unreleasedCount()).toBe(0);
  });

  it('rejects with the rollback failure when discardConnection released the runner itself', async () => {
    dataSource.subscribers.push(rollbackAlwaysFailing());
    const releasingDiscard: ConnectionDiscard = (queryRunner) => queryRunner.release();

    const running = failingRun(unitOfWork(releasingDiscard), new Error('work failed'));

    await expect(running).rejects.toBeInstanceOf(TransactionRollbackError);
  });
});
