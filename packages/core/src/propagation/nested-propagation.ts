import type { ScopeStore } from '../scope/scope-store';
import type { RootTransaction } from '../transaction/root-transaction';
import type { SavepointTransaction } from '../transaction/savepoint-transaction';
import type { ResolvedRunOptions } from '../unit-of-work-options';
import type { PropagationStrategy, TransactionalWork } from './propagation-strategy';

export class NestedPropagation implements PropagationStrategy {
  constructor(
    private readonly store: ScopeStore,
    private readonly root: RootTransaction,
    private readonly savepoint: SavepointTransaction,
  ) {}

  run<Result>(work: TransactionalWork<Result>, options: ResolvedRunOptions<Result>): Promise<Result> {
    const current = this.store.current();
    if (current === undefined) {
      return this.root.run(work, options);
    }
    return this.savepoint.run(current, work, options);
  }
}
