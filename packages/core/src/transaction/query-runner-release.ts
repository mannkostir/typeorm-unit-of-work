import type { QueryRunner } from 'typeorm';
import { TransactionLeftOpenError, TransactionRollbackError } from '../errors/unit-of-work-errors';
import type { TransactionScope } from '../scope/transaction-scope';

export async function releaseSettled(scope: TransactionScope): Promise<void> {
  await scope.awaitSavepointStartsOnRunner();
  if (scope.queryRunner.isTransactionActive) {
    await releaseAbandoned(scope, new TransactionLeftOpenError());
  }
  await scope.queryRunner.release();
}

export async function releaseAbandoned(scope: TransactionScope, failure: unknown): Promise<never> {
  const { queryRunner } = scope;
  try {
    await scope.awaitSavepointStartsOnRunner();
    await rollBackLeftoverTransaction(queryRunner, failure);
  } finally {
    await queryRunner.release();
  }
  throw failure;
}

async function rollBackLeftoverTransaction(queryRunner: QueryRunner, failure: unknown): Promise<void> {
  try {
    while (queryRunner.isTransactionActive) {
      await queryRunner.rollbackTransaction();
    }
  } catch (rollbackError) {
    throw new TransactionRollbackError(failure, rollbackError);
  }
}
