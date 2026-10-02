# typeorm-unit-of-work

Ambient TypeORM transactions and aggregate domain events, published before and after commit. Open a unit of work once, and every repository you obtain from it inside the callback, at any call depth, joins the same transaction through `AsyncLocalStorage`. Aggregates you save are collected, and their domain events are delivered to handlers inside the transaction (before commit) and after it has committed. The core is framework-agnostic; an optional NestJS adapter is published separately. It supports TypeORM 0.3 and 1.x.

Status: 0.1.1 — pre-release; the API may change before 1.0

## Install

```sh
npm install typeorm-unit-of-work
```

For NestJS, add the adapter:

```sh
npm install typeorm-unit-of-work-nestjs
```

Requires Node `^22.13.0 || >=24.11.0` and `typeorm ^0.3.20 || ^1.0.0`. The NestJS adapter supports `@nestjs/common` and `@nestjs/core` 11 and 12; `@nestjs/cqrs` 11 or 12 is optional.

Import the packages consistently, either all as ESM or all as CommonJS. Mixing the two loads each package twice, which duplicates its classes (so `instanceof` checks and Nest DI tokens stop matching) and the per-`DataSource` subscriber registry.

## Quick start

```ts
import { AggregateRoot, InProcessEventPublisher, UnitOfWork } from 'typeorm-unit-of-work';

class OrderShipped {
  constructor(readonly orderId: string) {}
}

class Order extends AggregateRoot {
  id = '';
  status = 'placed';

  ship(): void {
    this.status = 'shipped';
    this.addDomainEvent(new OrderShipped(this.id));
  }
}

const publisher = new InProcessEventPublisher();
publisher.onAfterCommit(OrderShipped, (event) => mailer.sendShippingNotice(event.orderId));

const uow = new UnitOfWork({
  dataSource,
  publisher,
  onAfterCommitError: (error, event) => logger.error({ error, event }, 'after-commit handler failed'),
});

await uow.run(async () => {
  const orders = uow.getRepository(Order);
  const order = await orders.findOneByOrFail({ id });
  order.ship();
  await orders.save(order);
});
```

`AggregateRoot` is optional. Any object with a `pullDomainEvents(): readonly object[]` method is a `DomainEventSource`, so domain code does not have to import the library. `pullDomainEvents` returns the pending events and clears them.

## How events are collected

A TypeORM subscriber, registered once per `DataSource`, watches the transaction's entity manager. When an entity that is a `DomainEventSource` is inserted, updated, removed or soft-removed (`save`, `remove`, `softRemove`) through the manager of the current scope, it is tracked by that scope.

For anything else, call `uow.track(aggregate)` inside the scope. It throws `ScopeNotActiveError` outside one.

Query-builder `update()` and `delete()` are not collected, because no entity instance passes through the subscriber. Call `uow.track()` on the affected aggregates yourself.

## Phases

Before commit, after `work` resolves, the unit of work repeatedly pulls events from every tracked aggregate and passes them to `publisher.beforeCommit(events, tx)`. Before-commit handlers:

- run inside the transaction, and can write through `tx.manager` or `tx.getRepository()`; those writes commit or roll back together with the work;
- can change or track aggregates, which raises more events; the loop continues until no new events appear, for at most `maxEventRounds` rounds;
- reject the unit of work if they throw: the transaction rolls back and the error is rethrown unchanged.

After the commit succeeds, `publisher.afterCommit(events, onAfterCommitError)` runs. After-commit handlers:

- see committed data and run outside any transaction, even when the committed run was a `new` scope opened inside another;
- cannot fail the unit of work: an error from a handler goes to `onAfterCommitError` and the remaining handlers still run, and `run()` still resolves with the result. The one exception is `onAfterCommitError` itself throwing: `run()` then rejects with that error, even though the data is already committed.

If `work` throws, `commitWhen` returns `false` or throws, or a before-commit handler throws, the transaction rolls back, pending events are discarded and no after-commit handler runs. An error thrown by `commitWhen` is rethrown unchanged.

Without `commitWhen`, every value `work` returns commits. Work that reports failure by returning a value instead of throwing, such as a neverthrow `Result`, an `Either` or an `{ ok: false }` object, therefore commits its partial writes and publishes its events. Reject such values with `commitWhen`:

```ts
const result = await uow.run(() => placeOrder(command), { commitWhen: (outcome) => outcome.isOk() });
```

On a failure the transaction rolls back, pending events are discarded, and `run()` returns the failure value. `@Transactional()` takes the same option. A `'join'` run inside an existing scope ignores its own `commitWhen`: the `commitWhen` of the run that opened the transaction or savepoint decides.

Events are ordered per aggregate, not globally. When a savepoint's aggregates merge into its parent, events of different aggregates may be delivered in a different order from the one they were raised in; the events of one aggregate keep their order.

`InProcessEventPublisher` matches handlers with `event instanceof EventClass` and runs them sequentially, in registration order, per event, in event order. Register them with `onBeforeCommit(EventClass, (event, tx) => ...)` and `onAfterCommit(EventClass, (event) => ...)`. To deliver events elsewhere, implement the `DomainEventPublisher` interface.

## Propagation

| `propagation` | No current scope | Current scope exists |
|---|---|---|
| `'join'` (default) | Opens a root transaction: drains events, commits, publishes after commit. | Runs `work` inside the current scope with no boundary of its own. Nothing is drained, committed or published at this level, and `commitWhen` and `isolationLevel` are ignored. An application error the caller catches does not roll the outer transaction back, but a failed database statement does on Postgres (see below). |
| `'new'` | Same as above. | Opens a root transaction on a new query runner, with its own commit and its own events, regardless of the outer scope. It holds two pooled connections while nested. The outer scope is restored when it finishes. |
| `'nested'` | Behaves as `'new'`. | Opens a savepoint on the parent's query runner. On success the savepoint is released and the tracked aggregates merge into the parent; events are drained only at the root. On failure, or when `commitWhen` returns `false`, it rolls back to the savepoint and discards the events raised inside it. `isolationLevel` is ignored. |

Events raised before a savepoint survive its rollback, at any nesting depth: the unit of work holds the pending events of every enclosing scope while a savepoint is open.

Postgres aborts the whole transaction when a statement fails. A caught database error inside a `'join'` run therefore leaves the outer transaction unusable: its `COMMIT` silently rolls back, `run()` still resolves, and after-commit handlers run for data that was never committed. To recover from a failed statement and keep the outer work, run the statement with `propagation: 'nested'`, as [the savepoint recovery test](packages/core/test/integration/savepoints.int.test.ts) does.

Savepoints on one transaction cannot overlap. Await `'nested'` runs one after another; starting a second `'nested'` run on the same parent while one is still open, for example with `Promise.all`, rejects it with `ConcurrentSavepointError` before it touches the connection.

Await every nested `uow.run()` before the enclosing work returns: a root or savepoint that would commit while a `'nested'` run inside it is still open rolls back instead and rejects with `OpenSavepointAtCommitError`.

A scope stops accepting work once it starts committing or rolling back, and ends when its transaction or savepoint finishes. A promise started inside `work` and left running afterwards cannot use it: `uow.manager`, `uow.getRepository()` and `uow.track()` called from it throw `ScopeNotActiveError`, and `uow.run()` with any propagation rejects with it.

TypeORM's own transaction subscribers (`beforeTransactionCommit`, `afterTransactionCommit`, `beforeTransactionRollback`, `afterTransactionRollback`) do not run inside the scope that is committing or rolling back. They see the scope of the code that called `uow.run()`:

- Around a `'nested'` run, that is the enclosing scope. `uow.manager` and `uow.getRepository()` return its manager, and `uow.track()` tracks into it. `uow.run()` with the default `'join'` propagation joins it; with `'nested'` it rejects with `ConcurrentSavepointError`, because the savepoint being committed or rolled back is still open; with `'new'` it opens a separate root, which on SQLite rejects with `ConnectionAlreadyInTransactionError`.
- Around a root opened with `propagation: 'new'` inside another scope, that is the outer scope. `uow.manager` and `uow.getRepository()` return the outer transaction's manager, which is a different transaction on another connection: writes made through it are not part of the transaction being committed or rolled back, and can deadlock against it.
- Around any other root, there is no scope. `uow.manager` and `uow.getRepository()` fall back to `dataSource.manager`, or throw `ScopeNotActiveError` when `strict` is on; `uow.track()` throws `ScopeNotActiveError`. `uow.run()` opens a new root transaction on Postgres, and rejects with `ConnectionAlreadyInTransactionError` on SQLite, whose only connection is still in the transaction. On Postgres both the `dataSource.manager` fallback and that new root use another connection: their writes are not part of the transaction being committed or rolled back, and can deadlock against it.

Use `event.manager` inside those subscribers, or register a before-commit handler on the publisher for work that belongs in the commit.

A `beforeTransactionStart` subscriber must not wait on anything that only happens once the same unit of work starts rolling back: something a `beforeTransactionRollback` or `afterTransactionRollback` subscriber does, or that unit of work's `run()` settling. Before rolling back, and before releasing its connection, a unit of work waits for every savepoint start still in flight on that connection, so such a subscriber makes `run()` never settle. A start can only be in flight at that point when a nested `uow.run()` was not awaited, so code that awaits every nested run cannot hit this.

SQLite limitation: SQLite shares one connection, so every query runner is the same object. `propagation: 'new'` inside a scope throws `ConnectionAlreadyInTransactionError`, and concurrent units of work are not supported on SQLite. Use `'join'` or `'nested'`.

Limitation: un-awaited work is not fenced. Await every nested `uow.run()` and every write before the enclosing work returns.

- A root or `'nested'` run that fails, or whose `commitWhen` returns `false`, while a `'nested'` run inside it is still open undoes only the innermost open savepoint with its own rollback. The root then finds its transaction still open and rejects with `TransactionLeftOpenError`, unless the root itself failed, in which case it rejects with its own error. Either way the whole transaction is rolled back and none of its data is kept.
- A write such as `repository.save()` that was started without `await` and is already past its scope check when the scope starts committing or rolling back is not stopped. Depending on timing it can land inside the transaction or, on SQLite, after it in autocommit mode.

Limitation: an event raised inside a savepoint that rolls back, on an aggregate that savepoint had not tracked by the time an inner savepoint opened (or never tracked), is not discarded. Only the events of aggregates tracked by the savepoint are dropped on rollback.

## Options reference

`UnitOfWorkOptions`, passed to `new UnitOfWork(options)`:

| Option | Type | Default | Notes |
|---|---|---|---|
| `dataSource` | `DataSource` | required | Must be initialized. |
| `publisher` | `DomainEventPublisher` | required | Usually an `InProcessEventPublisher`. |
| `onAfterCommitError` | `(error: unknown, event: object) => void` | required | No silent default. |
| `maxEventRounds` | `number` | `100` | An integer of at least 1. |
| `strict` | `boolean` | `false` | Throw `ScopeNotActiveError` from `manager` and `getRepository()` outside a scope, instead of falling back to `dataSource.manager`. |

`RunOptions<Result>`, passed as the second argument of `uow.run(work, options)`. It is generic over the result of `work`, so `commitWhen` is typed `(result: Result) => boolean`:

| Option | Type | Default | Notes |
|---|---|---|---|
| `propagation` | `'join' \| 'new' \| 'nested'` | `'join'` | See Propagation. |
| `isolationLevel` | TypeORM `IsolationLevel` | driver default | Applies only when a new transaction is opened. Ignored by `'join'` and by `'nested'` when a parent scope exists. |
| `commitWhen` | `(result: Result) => boolean` | always `true` | When it returns `false`, the transaction rolls back and `run()` returns the result. When it throws, the transaction rolls back and `run()` rejects with that error. |

`UnitOfWork` members: `run(work, options?)`, `manager`, `getRepository(target)` and `track(aggregate)`. `work` receives a `TransactionContext` exposing `manager` and `getRepository`; the query runner is never exposed.

## Errors

Every error extends `UnitOfWorkError`.

| Error | Thrown when |
|---|---|
| `TransactionRollbackError` | The rollback itself failed. Carries `originalError` and `rollbackError`; `originalError` is `undefined` when the rollback was caused by `commitWhen` returning `false`. If the final rollback before the connection is released fails as well, `run()` rejects with another `TransactionRollbackError` whose `originalError` is the error that was propagating; the connection is still released, because TypeORM's public `QueryRunner.release()` cannot discard it. |
| `EventCascadeLimitExceededError` | Before-commit handlers were still raising events after `maxEventRounds` rounds. Carries `rounds` and `lastRoundEventNames`. The transaction rolls back. |
| `ScopeNotActiveError` | `track()` is called outside a scope, or `manager` or `getRepository()` is used outside a scope when `strict` is on, or any of `manager`, `getRepository()`, `track()` and `run()` is called from a scope that is committing, rolling back or already finished. |
| `DataSourceNotInitializedError` | The `UnitOfWork` constructor receives a `DataSource` that is not initialized. |
| `InvalidUnitOfWorkOptionsError` | Constructor or `run()` options are invalid, including a missing `dataSource`. Carries `option`. |
| `ConnectionAlreadyInTransactionError` | A root scope is requested on a driver whose query runner is already inside a transaction, as on SQLite. |
| `ConcurrentSavepointError` | A `'nested'` run starts while another `'nested'` run on the same parent is still open. Await nested runs sequentially. |
| `OpenSavepointAtCommitError` | A root or `'nested'` run reaches its commit while a `'nested'` run inside it is still open, typically one started without `await`. The transaction or savepoint rolls back, its events are discarded and no after-commit handler runs. Await every nested `uow.run()` before the enclosing work returns. |
| `TransactionLeftOpenError` | The transaction was still open after the root commit, because a savepoint was left unreleased, as when a caught `OpenSavepointAtCommitError` left one behind. Whatever remained open is rolled back and no after-commit handler runs; check which data was stored. |
| `TransactionalBindingError` | From the NestJS adapter: `@Transactional()` is on a controller, or on a provider that is request-scoped or transient. |

Errors thrown by `work`, by `commitWhen` or by before-commit handlers are rethrown unchanged after the rollback. After-commit handler errors never reject `run()`, unless `onAfterCommitError` itself throws.

## NestJS

```ts
import { Module } from '@nestjs/common';
import { CqrsModule, EventBus } from '@nestjs/cqrs';
import { DataSource } from 'typeorm';
import { CqrsEventBusPublisher, UnitOfWorkModule } from 'typeorm-unit-of-work-nestjs';

@Module({
  imports: [
    CqrsModule.forRoot(),
    UnitOfWorkModule.forRootAsync({
      imports: [CqrsModule],
      inject: [DataSource, EventBus],
      useFactory: (dataSource: DataSource, eventBus: EventBus) => ({
        dataSource,
        publisher: new CqrsEventBusPublisher(eventBus),
        onAfterCommitError: (error, event) => logger.error({ error, event }, 'after-commit handler failed'),
      }),
    }),
  ],
})
export class AppModule {}
```

`UnitOfWorkModule` is global and exports a `UnitOfWork`. `CqrsEventBusPublisher` accepts any `{ publish(event: object): unknown }`, so the adapter has no dependency on `@nestjs/cqrs`. After commit it runs the after-commit handlers of a wrapped `InProcessEventPublisher` (pass your own as the second constructor argument), then publishes each event to the bus; a failed publish is reported to `onAfterCommitError`.

Decorate a provider method with `@Transactional()`. It takes the same `RunOptions` as `uow.run()`, and it only accepts methods that return a `Promise`, because the decorated method runs inside `uow.run()` and always returns one:

```ts
import { Inject, Injectable } from '@nestjs/common';
import { UnitOfWork } from 'typeorm-unit-of-work';
import { Transactional } from 'typeorm-unit-of-work-nestjs';

@Injectable()
export class ShippingService {
  constructor(@Inject(UnitOfWork) private readonly uow: UnitOfWork) {}

  @Transactional({ isolationLevel: 'READ COMMITTED' })
  async ship(orderId: string): Promise<void> {
    const orders = this.uow.getRepository(Order);
    const order = await orders.findOneByOrFail({ id: orderId });
    order.ship();
    await orders.save(order);
  }
}
```

### Providers only

The decorator only records metadata. In `onModuleInit`, the adapter finds every statically scoped provider and replaces each decorated method with one that calls `uow.run()`. There is no global holder. Consequently:

- Controllers are not supported, because Nest registers routes before `onModuleInit`. Put transactions in application services.
- `@Transactional()` on a controller, on a request-scoped provider or on a transient provider fails bootstrap with `TransactionalBindingError`.
- A `@Transactional()` method on a request-scoped provider registered through `useFactory` cannot be detected at bootstrap, and it runs without a transaction. Use singleton providers.

## Migrating from `typeorm-transactional`

- Replace `@Transactional()` from `typeorm-transactional` with `@Transactional()` from `typeorm-unit-of-work-nestjs`, or wrap the code in `uow.run()`.
- Repositories injected with `@InjectRepository()` or obtained from `dataSource.getRepository()` are not transactional here: they use `dataSource.manager`, so their writes bypass the unit of work and commit on their own. Inside transactional code, replace them with `uow.getRepository(X)` or `context.getRepository(X)`.
- Replace `runOnTransactionCommit(cb)` with an after-commit handler on a domain event: raise the event from the aggregate and register the callback with `onAfterCommit`.

## Compared with `@nestjs-cls/transactional`

Both libraries propagate transactions through `AsyncLocalStorage`. This library adds aggregate event collection and before-commit and after-commit phases, and its core does not need Nest.

## Licence

MIT
