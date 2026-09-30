# typeorm-unit-of-work

Ambient TypeORM transactions and aggregate domain events, published before and after commit. Open a unit of work once, and every repository you obtain from it inside the callback, at any call depth, joins the same transaction through `AsyncLocalStorage`. Aggregates you save are collected, and their domain events are delivered to handlers inside the transaction (before commit) and after it has committed. The core is framework-agnostic; an optional NestJS adapter is published separately. It supports TypeORM 0.3 and 1.x.

Status: 0.1.0 — pre-release; the API may change before 1.0

## Install

```sh
npm install typeorm-unit-of-work
```

For NestJS, add the adapter:

```sh
npm install typeorm-unit-of-work-nestjs
```

Requires Node `^22.13.0 || >=24.11.0` and `typeorm ^0.3.20 || ^1.0.0`.

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
- cannot fail the unit of work: an error from a handler goes to `onAfterCommitError` and the remaining handlers still run, and `run()` still resolves with the result.

If `work` throws, `commitWhen` returns `false` or a before-commit handler throws, the transaction rolls back, pending events are discarded and no after-commit handler runs.

`InProcessEventPublisher` matches handlers with `event instanceof EventClass` and runs them sequentially, in registration order, per event, in event order. Register them with `onBeforeCommit(EventClass, (event, tx) => ...)` and `onAfterCommit(EventClass, (event) => ...)`. To deliver events elsewhere, implement the `DomainEventPublisher` interface.

## Propagation

| `propagation` | No current scope | Current scope exists |
|---|---|---|
| `'join'` (default) | Opens a root transaction: drains events, commits, publishes after commit. | Runs `work` inside the current scope with no boundary of its own. Nothing is drained, committed or published at this level, and `commitWhen` and `isolationLevel` are ignored. An error the caller catches does not roll the outer transaction back. |
| `'new'` | Same as above. | Opens a root transaction on a new query runner, with its own commit and its own events, regardless of the outer scope. It holds two pooled connections while nested. The outer scope is restored when it finishes. |
| `'nested'` | Behaves as `'new'`. | Opens a savepoint on the parent's query runner. On success the savepoint is released and the tracked aggregates merge into the parent; events are drained only at the root. On failure, or when `commitWhen` returns `false`, it rolls back to the savepoint and discards the events raised inside it. |

Events raised before a savepoint survive its rollback, at any nesting depth: the unit of work holds the pending events of every enclosing scope while a savepoint is open.

SQLite limitation: SQLite shares one connection, so every query runner is the same object. `propagation: 'new'` inside a scope throws `ConnectionAlreadyInTransactionError`, and concurrent units of work are not supported on SQLite. Use `'join'` or `'nested'`.

Limitation: an event raised inside a savepoint that rolls back, on an aggregate that the savepoint never saved, is not discarded. Only the events of aggregates tracked by the savepoint are dropped on rollback.

## Options reference

`UnitOfWorkOptions`, passed to `new UnitOfWork(options)`:

| Option | Type | Default | Notes |
|---|---|---|---|
| `dataSource` | `DataSource` | required | Must be initialized. |
| `publisher` | `DomainEventPublisher` | required | Usually an `InProcessEventPublisher`. |
| `onAfterCommitError` | `(error: unknown, event: object) => void` | required | No silent default. |
| `maxEventRounds` | `number` | `100` | An integer of at least 1. |
| `strict` | `boolean` | `false` | Throw `ScopeNotActiveError` from `manager` and `getRepository()` outside a scope, instead of falling back to `dataSource.manager`. |

`RunOptions`, passed as the second argument of `uow.run(work, options)`:

| Option | Type | Default | Notes |
|---|---|---|---|
| `propagation` | `'join' \| 'new' \| 'nested'` | `'join'` | See Propagation. |
| `isolationLevel` | TypeORM `IsolationLevel` | driver default | Applies only when a new transaction is opened. |
| `commitWhen` | `(result) => boolean` | always `true` | When it returns `false`, the transaction rolls back and `run()` returns the result. |

`UnitOfWork` members: `run(work, options?)`, `manager`, `getRepository(target)` and `track(aggregate)`. `work` receives a `TransactionContext` exposing `manager` and `getRepository`; the query runner is never exposed.

## Errors

Every error extends `UnitOfWorkError`.

| Error | Thrown when |
|---|---|
| `TransactionRollbackError` | The rollback itself failed. Carries `originalError` and `rollbackError`; `originalError` is `undefined` when the rollback was caused by `commitWhen` returning `false`. |
| `EventCascadeLimitExceededError` | Before-commit handlers were still raising events after `maxEventRounds` rounds. Carries `rounds` and `lastRoundEventNames`. The transaction rolls back. |
| `ScopeNotActiveError` | `track()` is called outside a scope, or `manager` or `getRepository()` is used outside a scope when `strict` is on. |
| `DataSourceNotInitializedError` | The `UnitOfWork` constructor receives a `DataSource` that is not initialized. |
| `InvalidUnitOfWorkOptionsError` | Constructor or `run()` options are invalid. Carries `option`. |
| `ConnectionAlreadyInTransactionError` | A root scope is requested on a driver whose query runner is already inside a transaction, as on SQLite. |
| `TransactionalBindingError` | From the NestJS adapter: `@Transactional()` is on a controller, or on a provider that is request-scoped or transient. |

Errors thrown by `work` or by before-commit handlers are rethrown unchanged after the rollback. After-commit handler errors never reject `run()`.

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

Decorate a provider method with `@Transactional()`. It takes the same `RunOptions` as `uow.run()`:

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
- Inside transactional code, replace `dataSource.getRepository(X)` with `uow.getRepository(X)`.
- Replace `runOnTransactionCommit(cb)` with an after-commit handler on a domain event: raise the event from the aggregate and register the callback with `onAfterCommit`.

## Compared with `@nestjs-cls/transactional`

Both libraries propagate transactions through `AsyncLocalStorage`. This library adds aggregate event collection and before-commit and after-commit phases, and its core does not need Nest.

## Licence

MIT
