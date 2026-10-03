# Reference

## `UnitOfWorkOptions`

Passed to `new UnitOfWork(options)`.

| Option | Type | Default | Notes |
|---|---|---|---|
| `dataSource` | `DataSource` | required | Must be initialized. |
| `publisher` | `DomainEventPublisher` | required | Usually an `InProcessEventPublisher`. |
| `onAfterCommitError` | `(error: unknown, event: object) => void` | required | No silent default. |
| `maxEventRounds` | `number` | `100` | An integer of at least 1. |
| `strict` | `boolean` | `false` | Throw `ScopeNotActiveError` from `manager` and `getRepository()` outside a scope, instead of falling back to `dataSource.manager`. |
| `discardConnection` | `(queryRunner: QueryRunner, failure: TransactionRollbackError) => Promise<void>` | none | Called when the transaction is still open after the final rollback before the connection is released. Use it to stop the connection from going back to the pool; see [Failed rollbacks](#failed-rollbacks). The connection is released afterwards either way. |

## `RunOptions<Result>`

Passed as the second argument of `uow.run(work, options)`, and to `@Transactional(options)`. It is generic over the result of `work`, so `commitWhen` is typed `(result: Result) => boolean`.

| Option | Type | Default | Notes |
|---|---|---|---|
| `propagation` | `'join' \| 'new' \| 'nested'` | `'join'` | See [Propagation](propagation.md). |
| `isolationLevel` | TypeORM `IsolationLevel` | driver default | Applies only when a new transaction is opened. Ignored by `'join'` and by `'nested'` when a parent scope exists. |
| `commitWhen` | `(result: Result) => boolean` | always `true` | When it returns `false`, the transaction rolls back and `run()` returns the result. When it throws, the transaction rolls back and `run()` rejects with that error. |

## `UnitOfWork`

Members: `run(work, options?)`, `manager`, `getRepository(target)` and `track(aggregate)`. `work` receives a `TransactionContext` exposing `manager` and `getRepository`; the query runner is never exposed to `work`.

## Errors

Every error extends `UnitOfWorkError`.

| Error | Thrown when |
|---|---|
| `TransactionRollbackError` | The rollback itself failed. Carries `originalError` and `rollbackError`; `originalError` is `undefined` when the rollback was caused by `commitWhen` returning `false`. If the final rollback before the connection is released fails as well, `run()` rejects with another `TransactionRollbackError` whose `originalError` is the error that was propagating; the connection is then released, after `discardConnection` when it is set. |
| `ConnectionDiscardError` | `discardConnection` rejected. Carries `rollbackFailure`, the `TransactionRollbackError`; the `discardConnection` error is its `cause`. The connection was released to the pool. |
| `EventCascadeLimitExceededError` | Before-commit handlers were still raising events after `maxEventRounds` rounds. Carries `rounds` and `lastRoundEventNames`. The transaction rolls back. |
| `ScopeNotActiveError` | `track()` is called outside a scope, or `manager` or `getRepository()` is used outside a scope when `strict` is on, or any of `manager`, `getRepository()`, `track()` and `run()` is called from a scope that is committing, rolling back or already finished. |
| `DataSourceNotInitializedError` | The `UnitOfWork` constructor receives a `DataSource` that is not initialized. |
| `InvalidUnitOfWorkOptionsError` | Constructor or `run()` options are invalid, including a missing `dataSource`. Carries `option`. |
| `ConnectionAlreadyInTransactionError` | A root scope is requested on a driver whose query runner is already inside a transaction, as on SQLite. |
| `ConcurrentSavepointError` | A `'nested'` run starts while another `'nested'` run on the same parent is still open. Await nested runs sequentially. |
| `OpenSavepointAtCommitError` | A root or `'nested'` run reaches its commit while a `'nested'` run inside it is still open, typically one started without `await`. The transaction or savepoint rolls back, its events are discarded and no after-commit handler runs. Await every nested `uow.run()` before the enclosing work returns. |
| `AggregateSavedDuringCommitError` | An aggregate is saved while a root transaction is committing, as from a TypeORM `beforeTransactionCommit` or `afterTransactionCommit` subscriber, when its events could no longer be published. Carries `aggregateName`. Before the commit the transaction rolls back; after it, `run()` rejects with the transaction's writes stored and no after-commit handler runs. Save aggregates from a before-commit handler on the publisher instead. |
| `TransactionLeftOpenError` | The transaction was still open after the root commit, because a savepoint was left unreleased, as when a caught `OpenSavepointAtCommitError` left one behind. Whatever remained open is rolled back and no after-commit handler runs; check which data was stored. |

Errors thrown by `work`, by `commitWhen` or by before-commit handlers are rethrown unchanged after the rollback. After-commit handler errors never reject `run()`, unless `onAfterCommitError` itself throws.

The NestJS adapter's `TransactionalBindingError` and the outbox writer's errors are listed in their own READMEs.

## Failed rollbacks

When the transaction is still open after the final rollback, the connection holds a transaction in an unknown state, often aborted. Released as it is, it goes back to the pool and the next unit of work that borrows it fails or runs inside that transaction. TypeORM's public `QueryRunner.release()` cannot tell the pool to drop a connection, so `discardConnection` lets you do it in a way that suits your driver.

On Postgres, end the transaction, terminate the connection's own backend and wait until the driver reports the connection closed. The pool then drops it instead of reusing it.

```ts
const uow = new UnitOfWork({
  dataSource,
  publisher,
  onAfterCommitError,
  discardConnection: async (queryRunner) => {
    const connection = await queryRunner.connect();
    const closed = new Promise((resolve) => connection.once('end', resolve));
    await queryRunner.query('ROLLBACK').catch(() => undefined);
    try {
      await queryRunner.query('SELECT pg_terminate_backend(pg_backend_pid())');
    } catch (error) {
      if (error instanceof Error && 'code' in error && error.code === '57P01') {
        await closed;
        return;
      }
      throw error;
    }
    throw new Error('The backend was not terminated');
  },
});
```

`ROLLBACK` comes first because an aborted transaction ignores every other command until it ends; if it fails, the failure surfaces through the terminate query that follows. The terminate query is expected to fail with SQLSTATE `57P01`, because it closes its own connection. Postgres reports that before the socket closes, so the hook then waits for the driver to report the connection closed; without that wait the pool can hand the dying connection to the next unit of work. Any other outcome rejects, so `run()` rejects with `ConnectionDiscardError` and the failure is visible instead of the poisoned connection returning to the pool silently. This recipe is for Postgres only; other drivers need their own way to close the connection.
