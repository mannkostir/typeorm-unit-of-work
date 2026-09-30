import { setTimeout } from 'node:timers/promises';
import type { DataSource, EntityManager } from 'typeorm';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { InProcessEventPublisher } from '../../src/events/in-process-event-publisher';
import { UnitOfWork } from '../../src/unit-of-work';
import { postgres } from './support/databases';
import { Order } from './support/model';
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

  it('releases both query runners of a new transaction nested in another', async () => {
    await uow.run(async () => {
      await uow.run(async () => undefined, { propagation: 'new' });
    });

    expect(queryRunners.unreleasedCount()).toBe(0);
  });
});
