import type { TransactionalWork } from '../propagation/propagation-strategy';
import type { ScopeRegistry } from '../scope/scope-registry';
import type { ScopeStore } from '../scope/scope-store';
import { TransactionScope } from '../scope/transaction-scope';
import type { ResolvedRunOptions } from '../unit-of-work-options';
import { abortOnFailure, abortScope } from './scope-abort';

export class SavepointTransaction {
  constructor(
    private readonly store: ScopeStore,
    private readonly registry: ScopeRegistry,
  ) {}

  run<Result>(
    parent: TransactionScope,
    work: TransactionalWork<Result>,
    options: ResolvedRunOptions<Result>,
  ): Promise<Result> {
    const child = new TransactionScope(parent.queryRunner);
    parent.aggregates.holdPendingEvents();
    return this.registry.withBinding(parent.queryRunner, child, async () => {
      await parent.queryRunner.startTransaction();
      return this.#settle(parent, child, work, options);
    });
  }

  async #settle<Result>(
    parent: TransactionScope,
    child: TransactionScope,
    work: TransactionalWork<Result>,
    options: ResolvedRunOptions<Result>,
  ): Promise<Result> {
    const result = await abortOnFailure(child, () => this.store.runIn(child, () => work(child.context)));
    if (!options.commitWhen(result)) {
      await abortScope(child, undefined);
      return result;
    }
    await abortOnFailure(child, () => child.queryRunner.commitTransaction());
    parent.aggregates.adopt(child.aggregates);
    return result;
  }
}
