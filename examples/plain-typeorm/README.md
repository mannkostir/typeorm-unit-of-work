# Plain TypeORM example

A unit of work with `typeorm-unit-of-work` and no framework, on in-memory SQLite.

It places orders A and B, then:

1. ships A: the before-commit handler writes an `OrderHistory` row in the same transaction, and the after-commit handler sends a shipping notice once the transaction has committed;
2. ships B and then A in one unit of work: A is already shipped, so the domain throws, the transaction rolls back, B stays placed, and neither handler runs for B.

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
npm start -w examples/plain-typeorm
```

`npm test -w examples/plain-typeorm` runs the same scenario as a test.

## Use it outside this repository

Copy the folder, replace `"typeorm-unit-of-work": "*"` in `package.json` with `"^0.2.0"`, replace `"extends": "../../tsconfig.base.json"` in both tsconfig files with your own compiler options, drop `paths` from `tsconfig.json` and the `alias` from `vitest.config.ts`, then run `npm install && npm start`.

## Where to look

- [`src/unit-of-work.ts`](src/unit-of-work.ts): the `UnitOfWork` and both event handlers
- [`src/shipping-service.ts`](src/shipping-service.ts): application code using `uow.run()` and `uow.getRepository()`
- [`src/order.ts`](src/order.ts): the aggregate raising `OrderShipped`
