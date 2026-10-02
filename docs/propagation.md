# Propagation

Pass `propagation` in the options of `uow.run(work, options)` or `@Transactional(options)`.

| `propagation` | No current scope | Current scope exists |
|---|---|---|
| `'join'` (default) | Opens a root transaction: drains events, commits, publishes after commit. | Runs `work` inside the current scope with no boundary of its own. Nothing is drained, committed or published at this level, and `commitWhen` and `isolationLevel` are ignored. An application error the caller catches does not roll the outer transaction back, but a failed database statement does on Postgres (see below). |
| `'new'` | Same as above. | Opens a root transaction on a new query runner, with its own commit and its own events, regardless of the outer scope. It holds two pooled connections while nested. The outer scope is restored when it finishes. |
| `'nested'` | Behaves as `'new'`. | Opens a savepoint on the parent's query runner. On success the savepoint is released and the tracked aggregates merge into the parent; events are drained only at the root. On failure, or when `commitWhen` returns `false`, it rolls back to the savepoint and discards the events raised inside it. `isolationLevel` is ignored. |

## Savepoints

Events raised before a savepoint survive its rollback, at any nesting depth: the unit of work holds the pending events of every enclosing scope while a savepoint is open.

Savepoints on one transaction cannot overlap. Await `'nested'` runs one after another; starting a second `'nested'` run on the same parent while one is still open, for example with `Promise.all`, rejects it with `ConcurrentSavepointError` before it touches the connection.

Await every nested `uow.run()` before the enclosing work returns: a root or savepoint that would commit while a `'nested'` run inside it is still open rolls back instead and rejects with `OpenSavepointAtCommitError`.

## Recovering from a failed statement on Postgres

Postgres aborts the whole transaction when a statement fails. A caught database error inside a `'join'` run therefore leaves the outer transaction unusable: its `COMMIT` silently rolls back, `run()` still resolves, and after-commit handlers run for data that was never committed. To recover from a failed statement and keep the outer work, run the statement with `propagation: 'nested'`, as [the savepoint recovery test](../packages/core/test/integration/savepoints.int.test.ts) does.

## Scope lifetime

A scope stops accepting work once it starts committing or rolling back, and ends when its transaction or savepoint finishes. A promise started inside `work` and left running afterwards cannot use it: `uow.manager`, `uow.getRepository()` and `uow.track()` called from it throw `ScopeNotActiveError`, and `uow.run()` with any propagation rejects with it.

## TypeORM transaction subscribers

TypeORM's own transaction subscribers (`beforeTransactionCommit`, `afterTransactionCommit`, `beforeTransactionRollback`, `afterTransactionRollback`) do not run inside the scope that is committing or rolling back. They see the scope of the code that called `uow.run()`:

- Around a `'nested'` run, that is the enclosing scope. `uow.manager` and `uow.getRepository()` return its manager, and `uow.track()` tracks into it. `uow.run()` with the default `'join'` propagation joins it; with `'nested'` it rejects with `ConcurrentSavepointError`, because the savepoint being committed or rolled back is still open; with `'new'` it opens a separate root, which on SQLite rejects with `ConnectionAlreadyInTransactionError`.
- Around a root opened with `propagation: 'new'` inside another scope, that is the outer scope. `uow.manager` and `uow.getRepository()` return the outer transaction's manager, which is a different transaction on another connection: writes made through it are not part of the transaction being committed or rolled back, and can deadlock against it.
- Around any other root, there is no scope. `uow.manager` and `uow.getRepository()` fall back to `dataSource.manager`, or throw `ScopeNotActiveError` when `strict` is on; `uow.track()` throws `ScopeNotActiveError`. `uow.run()` opens a new root transaction on Postgres, and rejects with `ConnectionAlreadyInTransactionError` on SQLite, whose only connection is still in the transaction. On Postgres both the `dataSource.manager` fallback and that new root use another connection: their writes are not part of the transaction being committed or rolled back, and can deadlock against it.

Use `event.manager` inside those subscribers, or register a before-commit handler on the publisher for work that belongs in the commit.

An aggregate saved through `event.manager` in `beforeTransactionCommit` or `afterTransactionCommit` of a root transaction would be tracked after the before-commit events were dispatched, so its events could never be published. The save rejects with `AggregateSavedDuringCommitError` instead. In `beforeTransactionCommit` the transaction rolls back; in `afterTransactionCommit` it has already committed, so `run()` rejects with its writes stored and no after-commit handler runs. Entities that are not a `DomainEventSource` are saved as usual. When a `'nested'` savepoint commits, an aggregate saved this way is tracked by the enclosing scope and its events are published with the root's. Save aggregates that belong in the commit from a before-commit handler on the publisher.

A `beforeTransactionStart` subscriber must not wait on anything that only happens once the same unit of work starts rolling back: something a `beforeTransactionRollback` or `afterTransactionRollback` subscriber does, or that unit of work's `run()` settling. Before rolling back, and before releasing its connection, a unit of work waits for every savepoint start still in flight on that connection, so such a subscriber makes `run()` never settle. A start can only be in flight at that point when a nested `uow.run()` was not awaited, so code that awaits every nested run cannot hit this.

## SQLite

SQLite shares one connection, so every query runner is the same object. `propagation: 'new'` inside a scope throws `ConnectionAlreadyInTransactionError`, and concurrent units of work are not supported on SQLite. Use `'join'` or `'nested'`.

## Known limitations

Un-awaited work is not fenced. Await every nested `uow.run()` and every write before the enclosing work returns.

- A root or `'nested'` run that fails, or whose `commitWhen` returns `false`, while a `'nested'` run inside it is still open undoes only the innermost open savepoint with its own rollback. The root then finds its transaction still open and rejects with `TransactionLeftOpenError`, unless the root itself failed, in which case it rejects with its own error. Either way the whole transaction is rolled back and none of its data is kept.
- A write such as `repository.save()` that was started without `await` and is already past its scope check when the scope starts committing or rolling back is not stopped. Depending on timing it can land inside the transaction or, on SQLite, after it in autocommit mode.

An event raised inside a savepoint that rolls back, on an aggregate that savepoint had not tracked by the time an inner savepoint opened (or never tracked), is not discarded. Only the events of aggregates tracked by the savepoint are dropped on rollback.
