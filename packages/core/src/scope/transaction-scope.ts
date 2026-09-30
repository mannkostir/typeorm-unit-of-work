import type { QueryRunner } from 'typeorm';
import { type TransactionContext, transactionContextOf } from '../transaction-context';
import { AggregateTracker } from './aggregate-tracker';

export class TransactionScope {
  readonly context: TransactionContext;
  readonly aggregates = new AggregateTracker();

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
}
