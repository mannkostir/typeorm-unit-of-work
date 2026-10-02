import type { DataSource, EntitySubscriberInterface, TransactionCommitEvent } from 'typeorm';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { AggregateSavedDuringCommitError } from '../../src/errors/unit-of-work-errors';
import { InProcessEventPublisher } from '../../src/events/in-process-event-publisher';
import { UnitOfWork } from '../../src/unit-of-work';
import { databases } from './support/databases';
import { AuditEntry, Order, OrderPlaced } from './support/model';
import { type QueryRunnerWatch, watchQueryRunners } from './support/query-runner-watch';

type LateSave = (event: TransactionCommitEvent) => Promise<unknown>;

class SaveOnceOnCommit implements EntitySubscriberInterface {
  #beforeCommit: LateSave | undefined;
  #afterCommit: LateSave | undefined;

  scheduleBeforeCommit(save: LateSave): void {
    this.#beforeCommit = save;
  }

  scheduleAfterCommit(save: LateSave): void {
    this.#afterCommit = save;
  }

  async beforeTransactionCommit(event: TransactionCommitEvent): Promise<void> {
    const save = this.#beforeCommit;
    this.#beforeCommit = undefined;
    await save?.(event);
  }

  async afterTransactionCommit(event: TransactionCommitEvent): Promise<void> {
    const save = this.#afterCommit;
    this.#afterCommit = undefined;
    await save?.(event);
  }
}

describe.each(databases)('saves inside TypeORM commit subscribers on $name', (database) => {
  let dataSource: DataSource;
  let published: object[];
  let uow: UnitOfWork;
  let commitSubscriber: SaveOnceOnCommit;
  let queryRunners: QueryRunnerWatch;

  beforeEach(async () => {
    dataSource = await database.open();
    published = [];
    commitSubscriber = new SaveOnceOnCommit();
    dataSource.subscribers.push(commitSubscriber);
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
    queryRunners = watchQueryRunners(dataSource);
  });

  afterEach(async () => {
    await dataSource.destroy();
  });

  it('rejects an aggregate saved while the unit of work commits', async () => {
    commitSubscriber.scheduleBeforeCommit((event) => event.manager.save(Order.place('o-late')));

    const run = uow.run(async () => {
      await uow.getRepository(Order).save(Order.place('o-1'));
    });

    await expect(run).rejects.toBeInstanceOf(AggregateSavedDuringCommitError);
  });

  it('rolls back the unit of work whose commit saved an aggregate', async () => {
    commitSubscriber.scheduleBeforeCommit((event) => event.manager.save(Order.place('o-late')));

    await uow
      .run(async () => {
        await uow.getRepository(Order).save(Order.place('o-1'));
      })
      .catch(() => undefined);

    expect({
      stored: await dataSource.getRepository(Order).count(),
      published,
      unreleased: queryRunners.unreleasedCount(),
    }).toEqual({ stored: 0, published: [], unreleased: 0 });
  });

  it('publishes an aggregate saved while a nested run commits', async () => {
    await uow.run(async () => {
      await uow.run(
        async () => {
          commitSubscriber.scheduleBeforeCommit((event) => event.manager.save(Order.place('o-late')));
        },
        { propagation: 'nested' },
      );
    });

    expect({ published, unreleased: queryRunners.unreleasedCount() }).toEqual({
      published: [new OrderPlaced('o-late')],
      unreleased: 0,
    });
  });

  it('publishes an aggregate saved after a nested run committed', async () => {
    await uow.run(async () => {
      await uow.run(
        async () => {
          commitSubscriber.scheduleAfterCommit((event) => event.manager.save(Order.place('o-late')));
        },
        { propagation: 'nested' },
      );
      await uow.getRepository(Order).save(Order.place('o-1'));
    });

    expect({
      stored: (await dataSource.getRepository(Order).find({ order: { id: 'ASC' } })).map((order) => order.id),
      published,
      unreleased: queryRunners.unreleasedCount(),
    }).toEqual({
      stored: ['o-1', 'o-late'],
      published: [new OrderPlaced('o-late'), new OrderPlaced('o-1')],
      unreleased: 0,
    });
  });

  it('still stores entities that raise no events when saved while committing', async () => {
    const audit = new AuditEntry();
    audit.message = 'committed';
    commitSubscriber.scheduleBeforeCommit((event) => event.manager.save(audit));

    await uow.run(async () => {
      await uow.getRepository(Order).save(Order.place('o-1'));
    });

    expect({ audits: await dataSource.getRepository(AuditEntry).count(), published }).toEqual({
      audits: 1,
      published: [new OrderPlaced('o-1')],
    });
  });

  it('rejects an aggregate saved after the unit of work committed, keeping what it committed', async () => {
    commitSubscriber.scheduleAfterCommit((event) => event.manager.save(Order.place('o-late')));

    const outcome = await uow
      .run(async () => {
        await uow.getRepository(Order).save(Order.place('o-1'));
      })
      .catch((error: unknown) => error);

    expect({
      rejected: outcome instanceof AggregateSavedDuringCommitError,
      stored: (await dataSource.getRepository(Order).find()).map((order) => order.id),
      published,
      unreleased: queryRunners.unreleasedCount(),
    }).toEqual({ rejected: true, stored: ['o-1'], published: [], unreleased: 0 });
  });
});
