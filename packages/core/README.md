# typeorm-unit-of-work

**One transaction, the aggregates it touched, their events published at the right phase.**

A Unit of Work for TypeORM. Open a transaction once and every repository below it joins, at any call depth, through `AsyncLocalStorage`. Aggregates you save are collected, and their domain events are delivered inside the transaction before commit, and again once it has committed. Framework-agnostic, zero runtime dependencies, TypeORM 0.3 and 1.x.

Status: 0.2.0 — pre-release; the API may change before 1.0

## Install

```sh
npm install typeorm-unit-of-work
```

Requires Node `^22.13.0 || >=24.11.0` and `typeorm ^0.3.20 || ^1.0.0`.

Import the packages consistently, either all as ESM or all as CommonJS. Mixing the two loads each package twice, which duplicates its classes, so `instanceof` checks stop matching and each `DataSource` gets two subscriber registries.

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

`AggregateRoot` is optional: any object with a `pullDomainEvents(): readonly object[]` method is collected, so domain code does not have to import the library.

## What happens in `run()`

1. A transaction opens, and every `uow.getRepository()` call inside the callback uses it.
2. Aggregates saved, removed or soft-removed through it are tracked. Track anything else with `uow.track(aggregate)`.
3. When the callback resolves, events are handed to before-commit handlers, which run inside the transaction and can write in it. Events they raise are drained too.
4. The transaction commits, then after-commit handlers run. Their errors go to `onAfterCommitError` and never undo the commit.

If the callback or a before-commit handler throws, the transaction rolls back and no after-commit handler runs. Work that returns failures instead of throwing can say so with `commitWhen`.

## Propagation

| `propagation` | Inside an existing scope |
|---|---|
| `'join'` (default) | Runs in the current transaction |
| `'new'` | Opens an independent transaction on another connection |
| `'nested'` | Opens a savepoint that can roll back without failing its parent |

Outside a scope, each of them opens a new transaction.

## Documentation

- [Events and phases](https://github.com/mannkostir/typeorm-unit-of-work/blob/main/docs/events.md)
- [Propagation](https://github.com/mannkostir/typeorm-unit-of-work/blob/main/docs/propagation.md) — savepoints, Postgres and SQLite behaviour, known limitations
- [Reference](https://github.com/mannkostir/typeorm-unit-of-work/blob/main/docs/reference.md) — options and errors

Add-ons: [`typeorm-unit-of-work-nestjs`](https://www.npmjs.com/package/typeorm-unit-of-work-nestjs) for NestJS, and [`typeorm-unit-of-work-outbox`](https://www.npmjs.com/package/typeorm-unit-of-work-outbox) for a transactional outbox.

## Licence

MIT
