# typeorm-unit-of-work-nestjs

NestJS adapter for [`typeorm-unit-of-work`](https://www.npmjs.com/package/typeorm-unit-of-work): a global module, a `@Transactional()` method decorator, and a publisher that forwards committed domain events to the `@nestjs/cqrs` `EventBus`.

## Install

```sh
npm install typeorm-unit-of-work typeorm-unit-of-work-nestjs
```

Supports `@nestjs/common` and `@nestjs/core` 11 and 12; `@nestjs/cqrs` 11 or 12 is optional. Requires Node `^22.13.0 || >=24.11.0`.

Import both packages consistently, either as ESM or as CommonJS. Mixing the two loads each package twice, so `UnitOfWork` resolves to two different DI tokens.

## Module

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

`UnitOfWorkModule` is global and exports a `UnitOfWork`. The factory returns the core's [`UnitOfWorkOptions`](https://github.com/mannkostir/typeorm-unit-of-work/blob/main/docs/reference.md).

## `@Transactional()`

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

It takes the same `RunOptions` as `uow.run()`, and only accepts methods that return a `Promise`, because the decorated method runs inside `uow.run()` and always returns one.

### Providers only

The decorator only records metadata. In `onModuleInit`, the adapter finds every statically scoped provider and replaces each decorated method with one that calls `uow.run()`. There is no global holder. Consequently:

- Controllers are not supported, because Nest registers routes before `onModuleInit`. Put transactions in application services.
- `@Transactional()` on a controller, on a request-scoped provider or on a transient provider fails bootstrap with `TransactionalBindingError`, which extends the core's `UnitOfWorkError`.
- A `@Transactional()` method on a request-scoped provider registered through `useFactory` cannot be detected at bootstrap, and it runs without a transaction. Use singleton providers.

## `CqrsEventBusPublisher`

It accepts any `{ publish(event: object): unknown }`, so the adapter has no dependency on `@nestjs/cqrs`. Before commit it runs the before-commit handlers of a wrapped `InProcessEventPublisher`. After commit it runs the after-commit handlers of that publisher (pass your own as the second constructor argument), then publishes each event to the bus; a failed publish is reported to `onAfterCommitError`.

## Documentation

How events, phases and propagation behave is documented with the core: [typeorm-unit-of-work](https://github.com/mannkostir/typeorm-unit-of-work#readme).

## Licence

MIT
