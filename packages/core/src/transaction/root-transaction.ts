import type { DataSource, QueryRunner } from 'typeorm';
import { ConnectionAlreadyInTransactionError } from '../errors/unit-of-work-errors';
import type { AfterCommitErrorHandler, DomainEventPublisher } from '../events/domain-event-publisher';
import { drainBeforeCommit } from '../events/drain-before-commit';
import type { TransactionalWork } from '../propagation/propagation-strategy';
import type { ScopeRegistry } from '../scope/scope-registry';
import type { ScopeStore } from '../scope/scope-store';
import { TransactionScope } from '../scope/transaction-scope';
import type { ResolvedRunOptions } from '../unit-of-work-options';
import { abortOnFailure, abortScope } from './scope-abort';

export interface RootTransactionDependencies {
  readonly dataSource: DataSource;
  readonly store: ScopeStore;
  readonly registry: ScopeRegistry;
  readonly publisher: DomainEventPublisher;
  readonly onAfterCommitError: AfterCommitErrorHandler;
  readonly maxEventRounds: number;
}

interface Settlement<Result> {
  readonly result: Result;
  readonly committedEvents: readonly object[];
}

export class RootTransaction {
  constructor(private readonly dependencies: RootTransactionDependencies) {}

  async run<Result>(work: TransactionalWork<Result>, options: ResolvedRunOptions<Result>): Promise<Result> {
    const { store, publisher, onAfterCommitError } = this.dependencies;
    const settlement = await this.#runInNewTransaction(work, options);
    await store.runDetached(() => publisher.afterCommit(settlement.committedEvents, onAfterCommitError));
    return settlement.result;
  }

  async #runInNewTransaction<Result>(
    work: TransactionalWork<Result>,
    options: ResolvedRunOptions<Result>,
  ): Promise<Settlement<Result>> {
    const { dataSource, registry } = this.dependencies;
    const queryRunner = dataSource.createQueryRunner();
    if (queryRunner.isTransactionActive) {
      throw new ConnectionAlreadyInTransactionError(dataSource.options.type);
    }
    const scope = new TransactionScope(queryRunner);
    try {
      return await registry.withBinding(queryRunner, scope, async () => {
        await abortOnFailure(scope, () => queryRunner.startTransaction(options.isolationLevel));
        return this.#settle(scope, work, options);
      });
    } finally {
      await rollBackLeftoverTransaction(queryRunner);
      await queryRunner.release();
    }
  }

  async #settle<Result>(
    scope: TransactionScope,
    work: TransactionalWork<Result>,
    options: ResolvedRunOptions<Result>,
  ): Promise<Settlement<Result>> {
    const result = await abortOnFailure(scope, () => this.dependencies.store.runIn(scope, () => work(scope.context)));
    const accepted = await abortOnFailure(scope, async () => options.commitWhen(result));
    if (!accepted) {
      await abortScope(scope, undefined);
      return { result, committedEvents: [] };
    }
    const committedEvents = await abortOnFailure(scope, () => this.#commit(scope));
    return { result, committedEvents };
  }

  async #commit(scope: TransactionScope): Promise<readonly object[]> {
    const { store, publisher, maxEventRounds } = this.dependencies;
    const events = await store.runIn(scope, () =>
      drainBeforeCommit(scope.aggregates, (batch) => publisher.beforeCommit(batch, scope.context), maxEventRounds),
    );
    await scope.queryRunner.commitTransaction();
    return events;
  }
}

async function rollBackLeftoverTransaction(queryRunner: QueryRunner): Promise<void> {
  if (!queryRunner.isTransactionActive) {
    return;
  }
  await queryRunner.rollbackTransaction().catch(keepOriginalError);
}

function keepOriginalError(): void {}
