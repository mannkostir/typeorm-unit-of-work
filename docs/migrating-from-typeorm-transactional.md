# Migrating from typeorm-transactional

Both libraries carry the current transaction through `AsyncLocalStorage`. The differences that matter when moving code over:

- `typeorm-transactional` patches TypeORM's `DataSource` and `Repository`, so every repository joins the current transaction. This library patches nothing: only repositories from `uow.getRepository()` and the manager from `uow.manager` take part.
- Side effects after commit are driven by domain events raised on aggregates, rather than by callbacks registered inside the transaction.
- The core needs no framework; the NestJS adapter is a separate package.

## Setup

Before:

```ts
import { addTransactionalDataSource, initializeTransactionalContext } from 'typeorm-transactional';

initializeTransactionalContext();
addTransactionalDataSource(dataSource);
```

After:

```ts
import { InProcessEventPublisher, UnitOfWork } from 'typeorm-unit-of-work';

const publisher = new InProcessEventPublisher();
const uow = new UnitOfWork({
  dataSource,
  publisher,
  onAfterCommitError: (error, event) => logger.error({ error, event }, 'after-commit handler failed'),
});
```

With NestJS, register `UnitOfWorkModule.forRootAsync` instead; see the [adapter's README](../packages/nestjs/README.md).

## Running work in a transaction

| typeorm-transactional | typeorm-unit-of-work |
|---|---|
| `@Transactional()` | `@Transactional()` from `typeorm-unit-of-work-nestjs`, on a singleton provider |
| `runInTransaction(fn, options)` | `uow.run(fn, options)` |
| `wrapInTransaction(fn, options)` | a function that calls `uow.run(() => fn(...args), options)` |

Outside Nest there is no decorator; call `uow.run()`.

## Repositories

Before:

```ts
@Injectable()
export class ShippingService {
  constructor(@InjectRepository(Order) private readonly orders: Repository<Order>) {}

  @Transactional()
  async ship(orderId: string): Promise<void> {
    const order = await this.orders.findOneByOrFail({ id: orderId });
    order.ship();
    await this.orders.save(order);
  }
}
```

After:

```ts
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

A repository from `@InjectRepository()` or `dataSource.getRepository()` still works here, but its writes bypass the unit of work and commit on their own. Search for them in transactional code before switching.

## Propagation

| `Propagation` | `propagation` |
|---|---|
| `REQUIRED` (default) | `'join'` (default) |
| `REQUIRES_NEW` | `'new'` |
| `NESTED` | `'nested'` |
| `MANDATORY`, `NEVER`, `NOT_SUPPORTED`, `SUPPORTS` | No equivalent. |

`'nested'` opens a savepoint and discards the events of aggregates tracked inside it when it rolls back; see [Propagation](propagation.md).

`isolationLevel` takes plain strings, not an enum. Replace `IsolationLevel.READ_UNCOMMITTED`, `IsolationLevel.READ_COMMITTED`, `IsolationLevel.REPEATABLE_READ` and `IsolationLevel.SERIALIZABLE` with `'READ UNCOMMITTED'`, `'READ COMMITTED'`, `'REPEATABLE READ'` and `'SERIALIZABLE'`. `'SNAPSHOT'` is accepted only with TypeORM 1.x. It is ignored for `'nested'`.

## Hooks

Before:

```ts
@Transactional()
async ship(orderId: string): Promise<void> {
  await this.orders.save(order);
  runOnTransactionCommit(() => this.mailer.sendShippingNotice(orderId));
}
```

After: the aggregate raises the event, and the handler is registered once.

```ts
class Order extends AggregateRoot {
  ship(): void {
    this.status = 'shipped';
    this.addDomainEvent(new OrderShipped(this.id));
  }
}

publisher.onAfterCommit(OrderShipped, (event) => mailer.sendShippingNotice(event.orderId));
```

The handler runs only after a successful commit, never for a rollback, and a failure goes to `onAfterCommitError` instead of the caller. Work that must happen inside the transaction goes to `publisher.onBeforeCommit`; if it throws, everything rolls back. See [Events and phases](events.md).

`runOnTransactionRollback` and `runOnTransactionComplete` have no equivalent: after a rollback the events are discarded and nothing runs.

## A working example

[`examples/nestjs-cqrs`](../examples/nestjs-cqrs) is a complete Nest application context using `@Transactional()`, a before-commit handler and an `@nestjs/cqrs` `EventsHandler`; [`examples/plain-typeorm`](../examples/plain-typeorm) does the same without a framework.
