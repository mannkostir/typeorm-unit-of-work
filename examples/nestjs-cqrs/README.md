# NestJS and `@nestjs/cqrs` example

`typeorm-unit-of-work-nestjs` in a Nest application context, on in-memory SQLite. Committed domain events reach an `@EventsHandler` through the `@nestjs/cqrs` `EventBus`.

It places orders A and B, then:

1. ships A in a `@Transactional()` method: the before-commit handler writes an `OrderHistory` row in the same transaction, and once the transaction has committed, `OrderShippedHandler` receives `OrderShipped` from the `EventBus` and sends a shipping notice;
2. ships B and then A in one `@Transactional()` call: A is already shipped, so the domain throws, the transaction rolls back, B stays placed, and nothing is published for B.

## Output

```
shipping A
before commit: history recorded for A
after commit: shipping notice sent for A
shipping B and A
rolled back: order A is already shipped
final state: A shipped, B placed, history entries: 1
```

## Run it in this repository

```sh
npm ci
npm run build
npm start -w examples/nestjs-cqrs
```

`npm test -w examples/nestjs-cqrs` runs the same scenario as a test.

## Use it outside this repository

Copy the folder, replace `"typeorm-unit-of-work": "*"` and `"typeorm-unit-of-work-nestjs": "*"` in `package.json` with `"^0.2.0"`, replace `"extends": "../../tsconfig.base.json"` in both tsconfig files with `"target": "ES2023"`, `"module": "nodenext"`, `"moduleResolution": "nodenext"`, `"strict": true`, `"skipLibCheck": true` and `"experimentalDecorators": true` (add `"noEmit": true` in `tsconfig.json`), drop `paths` from `tsconfig.json` and the `alias` from `vitest.config.ts`, then run `npm install && npm start`.

## Where to look

- [`src/app.module.ts`](src/app.module.ts): `UnitOfWorkModule.forRootAsync` with `CqrsEventBusPublisher`
- [`src/shipping.service.ts`](src/shipping.service.ts): `@Transactional()` methods using `uow.getRepository()`
- [`src/history-recording-publisher.ts`](src/history-recording-publisher.ts): the before-commit handler
- [`src/order-shipped.handler.ts`](src/order-shipped.handler.ts): the `@EventsHandler` that runs after commit
