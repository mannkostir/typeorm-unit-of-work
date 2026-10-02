import type { TransactionContext } from '../transaction-context';

export type AfterCommitErrorHandler = (error: unknown, event: object) => void;

export interface DomainEventPublisher {
  beforeCommit(events: readonly object[], context: TransactionContext): Promise<void>;
  afterCommit(events: readonly object[], reportError: AfterCommitErrorHandler): Promise<void>;
}
