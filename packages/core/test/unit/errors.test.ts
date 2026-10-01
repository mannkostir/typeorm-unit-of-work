import { describe, expect, it } from 'vitest';
import {
  ConcurrentSavepointError,
  ConnectionAlreadyInTransactionError,
  DataSourceNotInitializedError,
  EventCascadeLimitExceededError,
  InvalidUnitOfWorkOptionsError,
  OpenSavepointAtCommitError,
  ScopeNotActiveError,
  TransactionLeftOpenError,
  TransactionRollbackError,
  UnitOfWorkError,
} from '../../src/errors/unit-of-work-errors';

describe('unit of work errors', () => {
  it('names each error after its class', () => {
    expect(new ScopeNotActiveError('uow.track()').name).toBe('ScopeNotActiveError');
  });

  it('makes every library error a UnitOfWorkError', () => {
    expect(new DataSourceNotInitializedError()).toBeInstanceOf(UnitOfWorkError);
  });

  it('keeps both errors when a rollback fails', () => {
    const original = new Error('work failed');
    const rollback = new Error('connection lost');

    const error = new TransactionRollbackError(original, rollback);

    expect(error).toMatchObject({ originalError: original, rollbackError: rollback, cause: rollback });
  });

  it('reports the rounds and last event names when the cascade limit is exceeded', () => {
    const error = new EventCascadeLimitExceededError(3, ['OrderShipped', 'InvoiceIssued']);

    expect(error.message).toBe(
      'Before-commit handlers were still raising events after 3 rounds (last round: OrderShipped, InvoiceIssued). Break the handler cycle or raise maxEventRounds.',
    );
  });

  it('names the invalid option and the fix', () => {
    const error = new InvalidUnitOfWorkOptionsError('maxEventRounds', 'must be an integer of at least 1');

    expect(error.message).toBe('Invalid unit of work option "maxEventRounds": must be an integer of at least 1');
  });

  it('tells the caller which operation needs a unit of work', () => {
    expect(new ScopeNotActiveError('uow.track()').message).toBe(
      'uow.track() needs an active unit of work; call it inside uow.run()',
    );
  });

  it('explains why a shared connection cannot open an independent transaction', () => {
    expect(new ConnectionAlreadyInTransactionError('better-sqlite3').message).toBe(
      'The better-sqlite3 driver returned a query runner that is already inside a transaction. It shares one connection, so propagation "new" and concurrent units of work are not supported on it; use "join" or "nested".',
    );
  });

  it('tells the caller to await nested runs one after another', () => {
    expect(new ConcurrentSavepointError().message).toBe(
      'A nested run started while another nested run on the same transaction was still open. Savepoints on one transaction cannot overlap; await nested runs sequentially instead of running them concurrently.',
    );
  });

  it('tells the caller to await every nested run before committing', () => {
    expect(new OpenSavepointAtCommitError().message).toBe(
      'The unit of work tried to commit while one of its nested runs was still open, so it was rolled back and nothing was stored. Await every nested uow.run() before the enclosing work returns.',
    );
  });

  it('explains that a transaction still open after its commit was rolled back', () => {
    expect(new TransactionLeftOpenError().message).toBe(
      'The transaction was still open after the unit of work committed, so it was rolled back and nothing was stored. This happens when a nested uow.run() failed with OpenSavepointAtCommitError and the error was caught; await every nested uow.run() before the enclosing work returns.',
    );
  });
});
