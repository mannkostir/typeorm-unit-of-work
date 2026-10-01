import { type DataSource, QueryFailedError } from 'typeorm';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  ConcurrentSavepointError,
  OpenSavepointAtCommitError,
  ScopeNotActiveError,
  TransactionLeftOpenError,
} from '../../src/errors/unit-of-work-errors';
import { InProcessEventPublisher } from '../../src/events/in-process-event-publisher';
import { UnitOfWork } from '../../src/unit-of-work';
import { databases } from './support/databases';
import { closedGate, type Gate } from './support/gate';
import { Order, OrderPlaced, OrderShipped } from './support/model';
import { type QueryRunnerWatch, watchQueryRunners } from './support/query-runner-watch';

describe.each(databases)('nested savepoints on $name', (database) => {
  let dataSource: DataSource;
  let queryRunners: QueryRunnerWatch;
  let published: object[];
  let uow: UnitOfWork;
  let danglingRuns: Promise<unknown>[];

  const storedIds = async () =>
    (await dataSource.getRepository(Order).find({ order: { id: 'ASC' } })).map((order) => order.id);

  const place = (id: string) => uow.getRepository(Order).save(Order.place(id));

  const placeNested = (id: string) => uow.run(() => place(id), { propagation: 'nested' });

  const failNested = (work: () => Promise<unknown>) =>
    expect(
      uow.run(
        async () => {
          await work();
          throw new Error('nested failed');
        },
        { propagation: 'nested' },
      ),
    ).rejects.toThrow('nested failed');

  const leaveNestedOpen = async (gate: Gate, id: string): Promise<void> => {
    const started = closedGate();
    danglingRuns.push(
      uow
        .run(
          async () => {
            started.open();
            await gate.opened;
            await place(id);
          },
          { propagation: 'nested' },
        )
        .catch((error: unknown) => error),
    );
    await started.opened;
  };

  const settleDanglingRuns = (gate: Gate): Promise<unknown[]> => {
    gate.open();
    return Promise.all(danglingRuns);
  };

  const startNestedRunOnGate = (gate: Gate): void => {
    danglingRuns.push(
      gate.opened.then(() => uow.run(() => place('o-2'), { propagation: 'nested' })).catch((error: unknown) => error),
    );
  };

  const rootStartingNestedRunOnGate = (gate: Gate) =>
    uow.run(async () => {
      await place('o-1');
      startNestedRunOnGate(gate);
      return 'ok';
    });

  const failingRootStartingNestedRunOnGate = (gate: Gate, failure: Error) =>
    uow.run(async () => {
      await place('o-1');
      startNestedRunOnGate(gate);
      throw failure;
    });

  const rejectedRootStartingNestedRunOnGate = (gate: Gate) =>
    uow.run(
      async () => {
        await place('o-1');
        startNestedRunOnGate(gate);
        return 'rejected';
      },
      { commitWhen: () => false },
    );

  const openingOn = (
    hook: 'beforeTransactionCommit' | 'afterTransactionCommit' | 'beforeTransactionRollback',
    gate: Gate,
  ) => ({
    [hook]: () => gate.open(),
  });

  const rootReturningWithNestedOpen = (gate: Gate) =>
    uow.run(async () => {
      await place('o-1');
      await leaveNestedOpen(gate, 'o-2');
      return 'ok';
    });

  const nestedReturningWithNestedOpen = (gate: Gate) =>
    uow.run(async () => {
      await place('o-1');
      await uow.run(
        async () => {
          await place('o-2');
          await leaveNestedOpen(gate, 'o-3');
          return 'ok';
        },
        { propagation: 'nested' },
      );
    });

  const rootSwallowingOpenSavepointError = (gate: Gate) =>
    uow.run(async () => {
      await place('o-1');
      await uow
        .run(
          async () => {
            await place('o-2');
            await leaveNestedOpen(gate, 'o-3');
          },
          { propagation: 'nested' },
        )
        .catch(() => undefined);
      return 'ok';
    });

  beforeEach(async () => {
    danglingRuns = [];
    dataSource = await database.open();
    queryRunners = watchQueryRunners(dataSource);
    published = [];
    const publisher = new InProcessEventPublisher();
    publisher.onAfterCommit(OrderPlaced, (event) => {
      published.push(event);
    });
    publisher.onAfterCommit(OrderShipped, (event) => {
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

  it('commits nested work with the outer transaction and publishes its events after the outer commit', async () => {
    await uow.run(async () => {
      await place('o-1');
      await uow.run(() => place('o-2'), { propagation: 'nested' });
    });

    expect({ stored: await storedIds(), published }).toEqual({
      stored: ['o-1', 'o-2'],
      published: [new OrderPlaced('o-1'), new OrderPlaced('o-2')],
    });
  });

  it('keeps outer work and drops nested work and events when the savepoint rolls back', async () => {
    await uow.run(async () => {
      await place('o-1');
      await failNested(() => place('o-2'));
    });

    expect({ stored: await storedIds(), published }).toEqual({
      stored: ['o-1'],
      published: [new OrderPlaced('o-1')],
    });
  });

  it('keeps events raised before the savepoint on an aggregate touched inside it', async () => {
    await uow.run(async () => {
      const order = Order.place('o-1');
      await uow.getRepository(Order).save(order);
      await failNested(async () => {
        order.ship();
        await uow.getRepository(Order).save(order);
      });
    });

    expect(published).toEqual([new OrderPlaced('o-1')]);
  });

  it('recovers the outer transaction after a failed statement inside the savepoint', async () => {
    await uow.run(async () => {
      await place('o-1');
      await expect(
        uow.run(() => uow.getRepository(Order).insert({ id: 'o-1', status: 'duplicate' }), { propagation: 'nested' }),
      ).rejects.toThrow(QueryFailedError);
      await place('o-2');
    });

    expect(await storedIds()).toEqual(['o-1', 'o-2']);
  });

  it('rolls back to the savepoint and returns the result when commitWhen rejects it', async () => {
    const result = await uow.run(async () => {
      await place('o-1');
      return uow.run(
        async () => {
          await place('o-2');
          return 'rejected';
        },
        { propagation: 'nested', commitWhen: (outcome) => outcome !== 'rejected' },
      );
    });

    expect({ result, stored: await storedIds() }).toEqual({ result: 'rejected', stored: ['o-1'] });
  });

  it('keeps a committed middle savepoint when an inner one rolls back', async () => {
    await uow.run(async () => {
      await uow.run(
        async () => {
          await place('o-1');
          await failNested(() => place('o-2'));
        },
        { propagation: 'nested' },
      );
    });

    expect(await storedIds()).toEqual(['o-1']);
  });

  it('opens a transaction of its own when there is no outer one', async () => {
    await uow.run(() => place('o-1'), { propagation: 'nested' });

    expect({ stored: await storedIds(), published }).toEqual({
      stored: ['o-1'],
      published: [new OrderPlaced('o-1')],
    });
  });

  it('collects saves after the savepoint into the outer transaction again', async () => {
    await uow.run(async () => {
      await failNested(() => place('o-1'));
      await place('o-2');
    });

    expect(published).toEqual([new OrderPlaced('o-2')]);
  });

  it('sees uncommitted outer work from inside the savepoint', async () => {
    const visible = await uow.run(async () => {
      await place('o-1');
      return uow.run(() => uow.getRepository(Order).countBy({ id: 'o-1' }), { propagation: 'nested' });
    });

    expect(visible).toBe(1);
  });

  it('keeps an event raised in a middle savepoint when an inner savepoint saving the aggregate rolls back', async () => {
    await uow.run(async () => {
      const order = Order.place('o-1');
      await uow.getRepository(Order).save(order);
      await uow.run(
        async () => {
          order.ship();
          await failNested(() => uow.getRepository(Order).save(order));
        },
        { propagation: 'nested' },
      );
    });

    expect(published).toEqual([new OrderPlaced('o-1'), new OrderShipped('o-1')]);
  });

  it('rejects a second savepoint opened concurrently on the same parent', async () => {
    const outcomes = await uow.run(() => Promise.allSettled([placeNested('o-1'), placeNested('o-2')]));

    expect(outcomes[1]).toEqual({ status: 'rejected', reason: expect.any(ConcurrentSavepointError) });
  });

  it('keeps the first concurrent savepoint and the outer work after rejecting the second', async () => {
    await uow.run(async () => {
      await Promise.allSettled([placeNested('o-1'), placeNested('o-2')]);
      await place('o-3');
    });

    expect({
      stored: await storedIds(),
      published,
      releasedInsideTransaction: queryRunners.releasedInsideTransaction(),
    }).toEqual({
      stored: ['o-1', 'o-3'],
      published: [new OrderPlaced('o-1'), new OrderPlaced('o-3')],
      releasedInsideTransaction: false,
    });
  });

  it('opens sibling savepoints one after another after earlier ones fail or are rejected', async () => {
    await uow.run(async () => {
      await failNested(() => place('o-1'));
      await uow.run(() => place('o-2'), { propagation: 'nested', commitWhen: () => false });
      await placeNested('o-3');
      await placeNested('o-4');
    });

    expect(await storedIds()).toEqual(['o-3', 'o-4']);
  });

  it('releases every query runner', async () => {
    await uow.run(async () => {
      await failNested(() => place('o-1'));
    });

    expect({
      unreleased: queryRunners.unreleasedCount(),
      releasedInsideTransaction: queryRunners.releasedInsideTransaction(),
    }).toEqual({ unreleased: 0, releasedInsideTransaction: false });
  });

  it('rejects a root run that returns while a nested run is still open', async () => {
    const gate = closedGate();

    const outcome = await rootReturningWithNestedOpen(gate).catch((error: unknown) => error);
    await settleDanglingRuns(gate);

    expect(outcome).toBeInstanceOf(OpenSavepointAtCommitError);
  });

  it('stores and publishes nothing from a root run that returns while a nested run is still open', async () => {
    const gate = closedGate();

    await rootReturningWithNestedOpen(gate).catch(() => undefined);
    await settleDanglingRuns(gate);

    expect({ stored: await storedIds(), published }).toEqual({ stored: [], published: [] });
  });

  it('rejects a nested run that returns while its own nested run is still open', async () => {
    const gate = closedGate();

    const outcome = await nestedReturningWithNestedOpen(gate).catch((error: unknown) => error);
    await settleDanglingRuns(gate);

    expect(outcome).toBeInstanceOf(OpenSavepointAtCommitError);
  });

  it('stores and publishes nothing when a nested run returns while its own nested run is still open', async () => {
    const gate = closedGate();

    await nestedReturningWithNestedOpen(gate).catch(() => undefined);
    await settleDanglingRuns(gate);

    expect({ stored: await storedIds(), published }).toEqual({ stored: [], published: [] });
  });

  it('rejects a root run that commits after swallowing the open savepoint error of a nested run', async () => {
    const gate = closedGate();

    const outcome = await rootSwallowingOpenSavepointError(gate).catch((error: unknown) => error);
    await settleDanglingRuns(gate);

    expect(outcome).toBeInstanceOf(TransactionLeftOpenError);
  });

  it('stores and publishes nothing from a root run that swallowed the open savepoint error of a nested run', async () => {
    const gate = closedGate();

    await rootSwallowingOpenSavepointError(gate).catch(() => undefined);
    await settleDanglingRuns(gate);

    expect({ stored: await storedIds(), published }).toEqual({ stored: [], published: [] });
  });

  it('runs later units of work normally after refusing to commit with a nested run still open', async () => {
    const gate = closedGate();

    const outcome = await rootReturningWithNestedOpen(gate).catch((error: unknown) => error);
    await settleDanglingRuns(gate);
    await uow.run(() => place('o-4'));

    expect({
      refused: outcome instanceof OpenSavepointAtCommitError,
      stored: await storedIds(),
      published,
      releasedInsideTransaction: queryRunners.releasedInsideTransaction(),
    }).toEqual({
      refused: true,
      stored: ['o-4'],
      published: [new OrderPlaced('o-4')],
      releasedInsideTransaction: false,
    });
  });

  it('refuses a nested run started while the root commits and commits the root', async () => {
    const gate = closedGate();
    dataSource.subscribers.push(openingOn('beforeTransactionCommit', gate));

    const result = await rootStartingNestedRunOnGate(gate);
    const [dangling] = await settleDanglingRuns(gate);
    dataSource.subscribers.pop();

    expect({
      result,
      danglingRefused: dangling instanceof ScopeNotActiveError,
      stored: await storedIds(),
      published,
    }).toEqual({ result: 'ok', danglingRefused: true, stored: ['o-1'], published: [new OrderPlaced('o-1')] });
  });

  it('runs later units of work normally after refusing a nested run started while the root commits', async () => {
    const gate = closedGate();
    dataSource.subscribers.push(openingOn('beforeTransactionCommit', gate));
    await rootStartingNestedRunOnGate(gate).catch(() => undefined);
    const [dangling] = await settleDanglingRuns(gate);
    dataSource.subscribers.pop();

    await uow.run(() => place('o-3'));

    expect({
      danglingRefused: dangling instanceof ScopeNotActiveError,
      stored: await storedIds(),
      releasedInsideTransaction: queryRunners.releasedInsideTransaction(),
    }).toEqual({ danglingRefused: true, stored: ['o-1', 'o-3'], releasedInsideTransaction: false });
  });

  it('refuses a nested run started after the root committed and still publishes the root events', async () => {
    const gate = closedGate();
    dataSource.subscribers.push(openingOn('afterTransactionCommit', gate));

    const result = await rootStartingNestedRunOnGate(gate).catch((error: unknown) => error);
    const [dangling] = await settleDanglingRuns(gate);
    dataSource.subscribers.pop();

    expect({
      result,
      danglingRefused: dangling instanceof ScopeNotActiveError,
      stored: await storedIds(),
      published,
    }).toEqual({ result: 'ok', danglingRefused: true, stored: ['o-1'], published: [new OrderPlaced('o-1')] });
  });

  it('refuses a nested run started while a failed root rolls back and rethrows the failure', async () => {
    const gate = closedGate();
    const failure = new Error('work failed');
    dataSource.subscribers.push(openingOn('beforeTransactionRollback', gate));

    const outcome = await failingRootStartingNestedRunOnGate(gate, failure).catch((error: unknown) => error);
    const [dangling] = await settleDanglingRuns(gate);
    dataSource.subscribers.pop();
    await uow.run(() => place('o-3'));

    expect({
      rethrown: outcome === failure,
      danglingRefused: dangling instanceof ScopeNotActiveError,
      stored: await storedIds(),
      releasedInsideTransaction: queryRunners.releasedInsideTransaction(),
    }).toEqual({ rethrown: true, danglingRefused: true, stored: ['o-3'], releasedInsideTransaction: false });
  });

  it('refuses a nested run started while a root rejected by commitWhen rolls back and returns its result', async () => {
    const gate = closedGate();
    dataSource.subscribers.push(openingOn('beforeTransactionRollback', gate));

    const result = await rejectedRootStartingNestedRunOnGate(gate).catch((error: unknown) => error);
    const [dangling] = await settleDanglingRuns(gate);
    dataSource.subscribers.pop();
    await uow.run(() => place('o-3'));

    expect({
      result,
      danglingRefused: dangling instanceof ScopeNotActiveError,
      stored: await storedIds(),
      releasedInsideTransaction: queryRunners.releasedInsideTransaction(),
    }).toEqual({ result: 'rejected', danglingRefused: true, stored: ['o-3'], releasedInsideTransaction: false });
  });

  it('waits for a nested run that is still opening before rolling back a failed root', async () => {
    const failure = new Error('work failed');
    const danglingStarts: Promise<unknown>[] = [];

    const outcome = await uow
      .run(async () => {
        await place('o-1');
        danglingStarts.push(uow.run(() => place('o-2'), { propagation: 'nested' }).catch((error: unknown) => error));
        throw failure;
      })
      .catch((error: unknown) => error);
    const [dangling] = await Promise.all(danglingStarts);
    await uow.run(() => place('o-3'));

    expect({
      rethrown: outcome === failure,
      danglingRefused: dangling instanceof ScopeNotActiveError,
      stored: await storedIds(),
      releasedInsideTransaction: queryRunners.releasedInsideTransaction(),
    }).toEqual({ rethrown: true, danglingRefused: true, stored: ['o-3'], releasedInsideTransaction: false });
  });
});
