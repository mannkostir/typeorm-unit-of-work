import type { DataSource } from 'typeorm';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ConnectionAlreadyInTransactionError } from '../../src/errors/unit-of-work-errors';
import { InProcessEventPublisher } from '../../src/events/in-process-event-publisher';
import { UnitOfWork } from '../../src/unit-of-work';
import { sqlite } from './support/databases';
import { Order } from './support/model';

describe('transactions on sqlite only', () => {
  let dataSource: DataSource;
  let uow: UnitOfWork;

  beforeEach(async () => {
    dataSource = await sqlite.open();
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

  it('refuses a new transaction inside another on the shared connection', async () => {
    const outcome = await uow.run(async () =>
      uow.run(async () => undefined, { propagation: 'new' }).catch((error: unknown) => error),
    );

    expect(outcome).toBeInstanceOf(ConnectionAlreadyInTransactionError);
  });

  it('keeps the outer transaction usable after refusing a new one', async () => {
    await uow.run(async () => {
      await uow.run(async () => undefined, { propagation: 'new' }).catch(() => undefined);
      await uow.getRepository(Order).save(Order.place('o-1'));
    });

    expect(await dataSource.getRepository(Order).count()).toBe(1);
  });
});
