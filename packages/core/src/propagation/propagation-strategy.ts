import type { TransactionContext } from '../transaction-context';
import type { ResolvedRunOptions } from '../unit-of-work-options';

export type TransactionalWork<Result> = (context: TransactionContext) => Promise<Result>;

export interface PropagationStrategy {
  run<Result>(work: TransactionalWork<Result>, options: ResolvedRunOptions<Result>): Promise<Result>;
}
