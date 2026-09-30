import { describe, expect, expectTypeOf, it } from 'vitest';
import * as api from '../../src/index';
import type { RunOptions, TransactionContext, TransactionalWork, UnitOfWork } from '../../src/index';

describe('public API', () => {
  it('exports exactly the documented runtime values', () => {
    expect(Object.keys(api).sort()).toEqual([
      'AggregateRoot',
      'ConcurrentSavepointError',
      'ConnectionAlreadyInTransactionError',
      'DataSourceNotInitializedError',
      'EventCascadeLimitExceededError',
      'InProcessEventPublisher',
      'InvalidUnitOfWorkOptionsError',
      'ScopeNotActiveError',
      'TransactionRollbackError',
      'UnitOfWork',
      'UnitOfWorkError',
    ]);
  });

  it('types run with the result of the work', () => {
    const runNumber = (uow: UnitOfWork) => uow.run(async () => 42);

    expectTypeOf(runNumber).returns.resolves.toEqualTypeOf<number>();
  });

  it('types commitWhen with the result of the work', () => {
    expectTypeOf<RunOptions<number>['commitWhen']>().toEqualTypeOf<((result: number) => boolean) | undefined>();
  });

  it('passes the transaction context to the work', () => {
    expectTypeOf<Parameters<TransactionalWork<void>>[0]>().toEqualTypeOf<TransactionContext>();
  });
});
