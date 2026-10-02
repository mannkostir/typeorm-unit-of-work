import type { RootTransaction } from '../transaction/root-transaction';
import type { ResolvedRunOptions } from '../unit-of-work-options';
import type { PropagationStrategy, TransactionalWork } from './propagation-strategy';

export class NewPropagation implements PropagationStrategy {
  constructor(private readonly root: RootTransaction) {}

  run<Result>(work: TransactionalWork<Result>, options: ResolvedRunOptions<Result>): Promise<Result> {
    return this.root.run(work, options);
  }
}
