import { TransactionRollbackError } from '../errors/unit-of-work-errors';
import type { TransactionScope } from '../scope/transaction-scope';

export async function abortScope(scope: TransactionScope, originalError: unknown): Promise<void> {
  scope.stopAcceptingWork();
  scope.aggregates.discardPendingEvents();
  await scope.awaitSavepointStartsOnRunner();
  if (!scope.controlsItsTransaction() || !scope.queryRunner.isTransactionActive) {
    return;
  }
  try {
    await scope.queryRunner.rollbackTransaction();
  } catch (rollbackError) {
    throw new TransactionRollbackError(originalError, rollbackError);
  }
}

export async function abortOnFailure<Value>(scope: TransactionScope, step: () => Promise<Value>): Promise<Value> {
  try {
    return await step();
  } catch (error) {
    await abortScope(scope, error);
    throw error;
  }
}
