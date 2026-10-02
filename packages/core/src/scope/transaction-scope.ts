import type { QueryRunner } from 'typeorm';
import {
  AggregateSavedDuringCommitError,
  ConcurrentSavepointError,
  OpenSavepointAtCommitError,
  ScopeNotActiveError,
} from '../errors/unit-of-work-errors';
import type { DomainEventSource } from '../events/domain-event-source';
import { type TransactionContext, transactionContextOf } from '../transaction-context';
import { AggregateTracker } from './aggregate-tracker';

type ScopePhase = 'accepting-work' | 'committing' | 'aborting' | 'ended';

export class TransactionScope {
  readonly context: TransactionContext;
  readonly aggregates = new AggregateTracker();
  readonly #runnerOwner: TransactionScope;
  readonly #savepointStartsInFlight = new Set<Promise<unknown>>();
  #childSavepointOpen = false;
  #phase: ScopePhase = 'accepting-work';

  constructor(
    readonly queryRunner: QueryRunner,
    private readonly parent?: TransactionScope,
  ) {
    this.context = transactionContextOf(queryRunner.manager);
    this.#runnerOwner = parent === undefined ? this : parent.#runnerOwner;
  }

  trackSaved(aggregate: DomainEventSource): void {
    if (this.#hasDispatchedBeforeCommitEvents()) {
      throw new AggregateSavedDuringCommitError(aggregate.constructor.name);
    }
    this.aggregates.track(aggregate);
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

  startChildSavepoint(): Promise<void> {
    const start = this.queryRunner.startTransaction();
    this.#runnerOwner.#recordSavepointStart(start);
    return start;
  }

  async awaitSavepointStartsOnRunner(): Promise<void> {
    const starts = this.#runnerOwner.#savepointStartsInFlight;
    while (starts.size > 0) {
      await Promise.all(starts);
    }
  }

  beginCommit(): void {
    this.ensureOpen('uow.run()');
    if (this.#childSavepointOpen) {
      throw new OpenSavepointAtCommitError();
    }
    this.#phase = 'committing';
  }

  stopAcceptingWork(): void {
    if (this.#phase !== 'ended') {
      this.#phase = 'aborting';
    }
  }

  close(): void {
    this.#phase = 'ended';
  }

  controlsItsTransaction(): boolean {
    return this.#phase !== 'ended' && (this.parent === undefined || this.parent.#acceptsWork());
  }

  ensureOpen(operation: string): void {
    if (!this.#acceptsWork()) {
      throw new ScopeNotActiveError(operation);
    }
  }

  #recordSavepointStart(start: Promise<void>): void {
    const settled: Promise<unknown> = Promise.allSettled([start]).then(() => {
      this.#savepointStartsInFlight.delete(settled);
    });
    this.#savepointStartsInFlight.add(settled);
  }

  #hasDispatchedBeforeCommitEvents(): boolean {
    return this.#phase === 'committing' && this.parent === undefined;
  }

  #acceptsWork(): boolean {
    return this.#phase === 'accepting-work' && (this.parent === undefined || this.parent.#acceptsWork());
  }
}
