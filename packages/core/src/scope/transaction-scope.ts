import type { QueryRunner } from 'typeorm';
import {
  ConcurrentSavepointError,
  OpenSavepointAtCommitError,
  ScopeNotActiveError,
} from '../errors/unit-of-work-errors';
import { type TransactionContext, transactionContextOf } from '../transaction-context';
import { AggregateTracker } from './aggregate-tracker';

type ScopePhase = 'accepting-work' | 'committing' | 'ended';

export class TransactionScope {
  readonly context: TransactionContext;
  readonly aggregates = new AggregateTracker();
  #childSavepointOpen = false;
  #phase: ScopePhase = 'accepting-work';

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
    this.ensureOpen('uow.run()');
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

  beginCommit(): void {
    this.ensureOpen('uow.run()');
    if (this.#childSavepointOpen) {
      throw new OpenSavepointAtCommitError();
    }
    this.#phase = 'committing';
  }

  close(): void {
    this.#phase = 'ended';
  }

  hasEnded(): boolean {
    return this.#phase === 'ended' || (this.parent?.hasEnded() ?? false);
  }

  ensureOpen(operation: string): void {
    if (!this.#acceptsWork()) {
      throw new ScopeNotActiveError(operation);
    }
  }

  #acceptsWork(): boolean {
    return this.#phase === 'accepting-work' && (this.parent === undefined || this.parent.#acceptsWork());
  }
}
