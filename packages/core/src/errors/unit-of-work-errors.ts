export class UnitOfWorkError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = new.target.name;
  }
}

export class TransactionRollbackError extends UnitOfWorkError {
  constructor(
    readonly originalError: unknown,
    readonly rollbackError: unknown,
  ) {
    super('Rolling back the transaction failed; the error that caused the rollback is in originalError', {
      cause: rollbackError,
    });
  }
}

export class EventCascadeLimitExceededError extends UnitOfWorkError {
  constructor(
    readonly rounds: number,
    readonly lastRoundEventNames: readonly string[],
  ) {
    super(
      `Before-commit handlers were still raising events after ${rounds} rounds (last round: ${lastRoundEventNames.join(', ')}). Break the handler cycle or raise maxEventRounds.`,
    );
  }
}

export class ScopeNotActiveError extends UnitOfWorkError {
  constructor(operation: string) {
    super(`${operation} needs an active unit of work; call it inside uow.run()`);
  }
}

export class DataSourceNotInitializedError extends UnitOfWorkError {
  constructor() {
    super('The DataSource is not initialized; await dataSource.initialize() before creating a UnitOfWork');
  }
}

export class InvalidUnitOfWorkOptionsError extends UnitOfWorkError {
  constructor(
    readonly option: string,
    reason: string,
  ) {
    super(`Invalid unit of work option "${option}": ${reason}`);
  }
}

export class ConnectionAlreadyInTransactionError extends UnitOfWorkError {
  constructor(driverType: string) {
    super(
      `The ${driverType} driver returned a query runner that is already inside a transaction. It shares one connection, so propagation "new" and concurrent units of work are not supported on it; use "join" or "nested".`,
    );
  }
}
