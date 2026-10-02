# typeorm-unit-of-work

**One transaction, the aggregates it touched, their events published at the right phase.**

A Unit of Work for TypeORM. Open a transaction once and every repository below it joins, at any call depth, without passing an `EntityManager` around. Aggregates you save are collected, and their domain events are delivered inside the transaction before commit, and again once it has committed.

Status: 0.1.1 — pre-release; the API may change before 1.0

## Why

Two bugs show up in almost every TypeORM codebase that raises domain events:

- **The email went out, the transaction rolled back.** A handler reacted to an event before the data it describes was committed.
- **The row committed, the event was lost.** The event was published after the commit, and the process died in between.

Avoiding them by hand means threading a transactional `EntityManager` through every function and deciding, at each call site, which side effects must wait for the commit. The core makes the first bug impossible by default, and the [outbox writer](packages/outbox/README.md) closes the second by storing events in the same transaction as the data.

What you get:

- **Ambient transactions.** `uow.getRepository(Order)` anywhere inside `uow.run()` uses the current transaction, carried by `AsyncLocalStorage`.
- **Two event phases.** Before-commit handlers run inside the transaction and can write in it; if they throw, everything rolls back. After-commit handlers see committed data only, and never run for a rollback.
- **Propagation you choose.** Join the current transaction, open an independent one, or open a savepoint that can fail without failing its parent.
- **No framework, no lock-in.** The core has zero runtime dependencies and imports TypeORM types only. Domain code does not have to import it at all.

## Quick start

```sh
npm install typeorm-unit-of-work
```

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

The shipping notice is sent only after the commit succeeds. If anything inside `run()` throws, the transaction rolls back and the event is discarded.

## Packages

| Package | What it adds |
|---|---|
| [`typeorm-unit-of-work`](packages/core/README.md) | The framework-agnostic core |
| [`typeorm-unit-of-work-nestjs`](packages/nestjs/README.md) | `UnitOfWorkModule`, `@Transactional()` and a bridge to the `@nestjs/cqrs` `EventBus` |
| [`typeorm-unit-of-work-outbox`](packages/outbox/README.md) | A transactional outbox writer: events stored as Debezium-compatible rows in the same transaction (Postgres) |

Requires Node `^22.13.0 || >=24.11.0` and `typeorm ^0.3.20 || ^1.0.0`. The NestJS adapter supports Nest 11 and 12.

## With NestJS

```ts
import { Inject, Injectable } from '@nestjs/common';
import { UnitOfWork } from 'typeorm-unit-of-work';
import { Transactional } from 'typeorm-unit-of-work-nestjs';

@Injectable()
export class ShippingService {
  constructor(@Inject(UnitOfWork) private readonly uow: UnitOfWork) {}

  @Transactional()
  async ship(orderId: string): Promise<void> {
    const orders = this.uow.getRepository(Order);
    const order = await orders.findOneByOrFail({ id: orderId });
    order.ship();
    await orders.save(order);
  }
}
```

Module setup and the `@nestjs/cqrs` bridge are in the [adapter's README](packages/nestjs/README.md).

## Compared with alternatives

`typeorm-transactional` and `@nestjs-cls/transactional` also propagate transactions through `AsyncLocalStorage`. This library adds aggregate event collection with before-commit and after-commit phases, and its core does not need Nest.

Coming from `typeorm-transactional`:

- Replace its `@Transactional()` with the one from `typeorm-unit-of-work-nestjs`, or wrap the code in `uow.run()`.
- Repositories from `@InjectRepository()` or `dataSource.getRepository()` are not transactional here: their writes bypass the unit of work and commit on their own. Inside transactional code, use `uow.getRepository(X)`.
- Replace `runOnTransactionCommit(cb)` with an after-commit handler: raise an event from the aggregate and register the callback with `onAfterCommit`.

## Documentation

- [Events and phases](docs/events.md) — how aggregates are collected, what each phase guarantees, and `commitWhen` for work that returns failures instead of throwing
- [Propagation](docs/propagation.md) — `join`, `new` and `nested`, savepoints, Postgres and SQLite behaviour, and known limitations
- [Reference](docs/reference.md) — every option and every error

## Licence

MIT
