import type { QueryRunner } from 'typeorm';
import { ConcurrentSavepointError, ScopeNotActiveError } from '../errors/unit-of-work-errors';
import { type TransactionContext, transactionContextOf } from '../transaction-context';
import { AggregateTracker } from './aggregate-tracker';

export class TransactionScope {
  readonly context: TransactionContext;
  readonly aggregates = new AggregateTracker();
  #childSavepointOpen = false;
  #closed = false;

  constructor(
    readonly queryRunner: QueryRunner,
    private readonly parent?: TransactionScope,
  ) {
    this.context = transactionContextOf(queryRunner.manager);
  }

  holdPendingEventsAlongAncestry(): void {
    this.aggregates.holdPendingEvents();
    this.parent?.holdPendingEventsAlongAncestry();
  }

  async withChildSavepoint<Value>(savepoint: () => Promise<Value>): Promise<Value> {
    if (this.#childSavepointOpen) {
      throw new ConcurrentSavepointError();
    }
    this.#childSavepointOpen = true;
    try {
      return await savepoint();
    } finally {
      this.#childSavepointOpen = false;
    }
  }

  close(): void {
    this.#closed = true;
  }

  ensureOpen(operation: string): void {
    if (this.#closed) {
      throw new ScopeNotActiveError(operation);
    }
  }
}
