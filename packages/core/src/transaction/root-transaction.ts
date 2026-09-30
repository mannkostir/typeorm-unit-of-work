import type { DataSource } from 'typeorm';
import { ConnectionAlreadyInTransactionError } from '../errors/unit-of-work-errors';
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
}

export class RootTransaction {
  constructor(private readonly dependencies: RootTransactionDependencies) {}

  async run<Result>(work: TransactionalWork<Result>, options: ResolvedRunOptions<Result>): Promise<Result> {
    const { dataSource, registry } = this.dependencies;
    const queryRunner = dataSource.createQueryRunner();
    if (queryRunner.isTransactionActive) {
      throw new ConnectionAlreadyInTransactionError(dataSource.options.type);
    }
    const scope = new TransactionScope(queryRunner);
    try {
      return await registry.withBinding(queryRunner, scope, async () => {
        await queryRunner.startTransaction(options.isolationLevel);
        return this.#settle(scope, work, options);
      });
    } finally {
      await queryRunner.release();
    }
  }

  async #settle<Result>(
    scope: TransactionScope,
    work: TransactionalWork<Result>,
    options: ResolvedRunOptions<Result>,
  ): Promise<Result> {
    const result = await abortOnFailure(scope, () => this.dependencies.store.runIn(scope, () => work(scope.context)));
    if (!options.commitWhen(result)) {
      await abortScope(scope, undefined);
      return result;
    }
    await abortOnFailure(scope, () => scope.queryRunner.commitTransaction());
    return result;
  }
}
