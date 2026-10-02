# Events and phases

## Aggregates

`AggregateRoot` is optional. Any object with a `pullDomainEvents(): readonly object[]` method is a `DomainEventSource`, so domain code does not have to import the library. `pullDomainEvents` returns the pending events and clears them.

## How events are collected

A TypeORM subscriber, registered once per `DataSource`, watches the transaction's entity manager. When an entity that is a `DomainEventSource` is inserted, updated, removed or soft-removed (`save`, `remove`, `softRemove`) through the manager of the current scope, it is tracked by that scope.

For anything else, call `uow.track(aggregate)` inside the scope. It throws `ScopeNotActiveError` outside one.

Query-builder `update()` and `delete()` are not collected, because no entity instance passes through the subscriber. Call `uow.track()` on the affected aggregates yourself.

## Before commit

After `work` resolves, the unit of work repeatedly pulls events from every tracked aggregate and passes them to `publisher.beforeCommit(events, tx)`. Before-commit handlers:

- run inside the transaction, and can write through `tx.manager` or `tx.getRepository()`; those writes commit or roll back together with the work;
- can change or track aggregates, which raises more events; the loop continues until no new events appear, for at most `maxEventRounds` rounds;
- reject the unit of work if they throw: the transaction rolls back and the error is rethrown unchanged.

## After commit

After the commit succeeds, `publisher.afterCommit(events, onAfterCommitError)` runs. After-commit handlers:

- see committed data and run outside any transaction, even when the committed run was a `new` scope opened inside another;
- cannot fail the unit of work: an error from a handler goes to `onAfterCommitError` and the remaining handlers still run, and `run()` still resolves with the result. The one exception is `onAfterCommitError` itself throwing: `run()` then rejects with that error, even though the data is already committed.

## Rollback

If `work` throws, `commitWhen` returns `false` or throws, or a before-commit handler throws, the transaction rolls back, pending events are discarded and no after-commit handler runs. An error thrown by `commitWhen` is rethrown unchanged.

## Work that returns failures

Without `commitWhen`, every value `work` returns commits. Work that reports failure by returning a value instead of throwing, such as a neverthrow `Result`, an `Either` or an `{ ok: false }` object, therefore commits its partial writes and publishes its events. Reject such values with `commitWhen`:

```ts
const result = await uow.run(() => placeOrder(command), { commitWhen: (outcome) => outcome.isOk() });
```

On a failure the transaction rolls back, pending events are discarded, and `run()` returns the failure value. `@Transactional()` takes the same option. A `'join'` run inside an existing scope ignores its own `commitWhen`: the `commitWhen` of the run that opened the transaction or savepoint decides.

## Ordering

Events are ordered per aggregate, not globally. When a savepoint's aggregates merge into its parent, events of different aggregates may be delivered in a different order from the one they were raised in; the events of one aggregate keep their order.

## Publishers

`InProcessEventPublisher` matches handlers with `event instanceof EventClass` and runs them sequentially, in registration order, per event, in event order. Register them with `onBeforeCommit(EventClass, (event, tx) => ...)` and `onAfterCommit(EventClass, (event) => ...)`.

To deliver events elsewhere, implement the `DomainEventPublisher` interface. The [NestJS adapter](../packages/nestjs/README.md) ships one that forwards to the `@nestjs/cqrs` `EventBus`, and the [outbox writer](../packages/outbox/README.md) wraps any publisher to also store events as outbox rows.
