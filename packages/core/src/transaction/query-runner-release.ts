import type { QueryRunner } from 'typeorm';
import {
  ConnectionDiscardError,
  TransactionLeftOpenError,
  TransactionRollbackError,
} from '../errors/unit-of-work-errors';
import type { TransactionScope } from '../scope/transaction-scope';
import type { ConnectionDiscard } from '../unit-of-work-options';

export class QueryRunnerRelease {
  constructor(private readonly discardConnection: ConnectionDiscard) {}

  async settled(scope: TransactionScope): Promise<void> {
    await scope.awaitSavepointStartsOnRunner();
    if (scope.queryRunner.isTransactionActive) {
      await this.abandoned(scope, new TransactionLeftOpenError());
    }
    await scope.queryRunner.release();
  }

  async abandoned(scope: TransactionScope, failure: unknown): Promise<never> {
    const { queryRunner } = scope;
    try {
      await scope.awaitSavepointStartsOnRunner();
      await this.#rollBackOrDiscard(queryRunner, failure);
    } finally {
      await queryRunner.release();
    }
    throw failure;
  }

  async #rollBackOrDiscard(queryRunner: QueryRunner, failure: unknown): Promise<void> {
    try {
      while (queryRunner.isTransactionActive) {
        await queryRunner.rollbackTransaction();
      }
    } catch (rollbackError) {
      const rollbackFailure = new TransactionRollbackError(failure, rollbackError);
      if (queryRunner.isTransactionActive) {
        await this.#discard(queryRunner, rollbackFailure);
      }
      throw rollbackFailure;
    }
  }

  async #discard(queryRunner: QueryRunner, rollbackFailure: TransactionRollbackError): Promise<void> {
    try {
      await this.discardConnection(queryRunner, rollbackFailure);
    } catch (discardError) {
      throw new ConnectionDiscardError(rollbackFailure, discardError);
    }
  }
}
