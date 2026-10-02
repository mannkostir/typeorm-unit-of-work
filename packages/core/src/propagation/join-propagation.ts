import type { ScopeStore } from '../scope/scope-store';
import type { RootTransaction } from '../transaction/root-transaction';
import type { ResolvedRunOptions } from '../unit-of-work-options';
import type { PropagationStrategy, TransactionalWork } from './propagation-strategy';

export class JoinPropagation implements PropagationStrategy {
  constructor(
    private readonly store: ScopeStore,
    private readonly root: RootTransaction,
  ) {}

  run<Result>(work: TransactionalWork<Result>, options: ResolvedRunOptions<Result>): Promise<Result> {
    const current = this.store.current();
    if (current === undefined) {
      return this.root.run(work, options);
    }
    return work(current.context);
  }
}
