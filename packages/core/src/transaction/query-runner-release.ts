import type { QueryRunner } from 'typeorm';
import { TransactionLeftOpenError, TransactionRollbackError } from '../errors/unit-of-work-errors';

export async function releaseSettled(queryRunner: QueryRunner): Promise<void> {
  if (queryRunner.isTransactionActive) {
    await releaseAbandoned(queryRunner, new TransactionLeftOpenError());
  }
  await queryRunner.release();
}

export async function releaseAbandoned(queryRunner: QueryRunner, failure: unknown): Promise<never> {
  try {
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
