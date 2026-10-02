# typeorm-unit-of-work-outbox

Transactional outbox writer for [`typeorm-unit-of-work`](https://www.npmjs.com/package/typeorm-unit-of-work). It stores domain events in an outbox table in the same transaction as the aggregates that raised them, so an event is stored if and only if its transaction commits. **Postgres only.**

**It does not deliver events.** A change-data-capture relay reads the committed inserts from the Postgres WAL and publishes them to your broker: Debezium with its Outbox Event Router, or any relay that reads the Debezium outbox layout.

## Install

```sh
npm install typeorm-unit-of-work typeorm-unit-of-work-outbox
```

Requires Node `^22.13.0 || >=24.11.0` and `typeorm ^0.3.20 || ^1.0.0`. Import both packages consistently, either as ESM or as CommonJS.

## Usage

```ts
import { InProcessEventPublisher, UnitOfWork } from 'typeorm-unit-of-work';
import { OutboxEventPublisher } from 'typeorm-unit-of-work-outbox';

const inProcess = new InProcessEventPublisher();
const outbox = new OutboxEventPublisher({ inner: inProcess });

outbox.register(OrderShipped, {
  type: 'order.shipped',
  aggregateType: 'order',
  aggregateId: (event) => event.orderId,
  payload: (event) => ({ orderId: event.orderId }),
});

const uow = new UnitOfWork({
  dataSource,
  publisher: outbox,
  onAfterCommitError: (error, event) => logger.error({ error, event }, 'after-commit handler failed'),
});
```

`OutboxEventPublisher` wraps your existing publisher: every event still reaches `inner` in both phases, and registered events are also written as outbox rows before commit. Unregistered events are not written. An event matches the registration of the nearest class on its prototype chain.

Rows are written once per before-commit round at the outermost transaction, so a rolled-back `nested` run, a failed outer run and a `commitWhen` that returns `false` store nothing. Events raised by before-commit handlers are written in the round that drains them.

## Migration

Create the table with the bundled migration, and add it to your DataSource's `migrations`:

```ts
import { createOutboxMigration } from 'typeorm-unit-of-work-outbox';

export const CreateOutbox = createOutboxMigration({ timestamp: 1759363200000, table: 'outbox' });
```

The migration's `table` must match the publisher's `table`; for `schema.table` the schema must already exist, and names are quoted, so they are case-sensitive. The migration creates the table only. Your relay's setup creates the publication and the replication slot.

| Column | Type | Value |
|---|---|---|
| `id` | `uuid`, primary key | A new random UUID; consumers deduplicate by it |
| `aggregatetype` | `varchar(255)` | `aggregateType` |
| `aggregateid` | `varchar(255)` | `aggregateId(event)`; relays use it as the message key |
| `type` | `varchar(255)` | `type` |
| `payload` | `jsonb`, nullable | `payload(event)`, or the event itself when `payload` is omitted; a `null` payload is stored as SQL `NULL`, and whether it is published as a tombstone depends on the relay (Debezium: `route.tombstone.on.empty.payload`) |

## Options

| Option | Default | Notes |
|---|---|---|
| `inner` | required | The publisher every event is also delivered to, usually `InProcessEventPublisher` |
| `table` | `'outbox'` | `table` or `schema.table` |
| `rows` | `'delete'` | `'delete'` removes each row in the same transaction right after inserting it, so the table stays empty while the insert still reaches the WAL. `'retain'` keeps rows; pruning them is then yours |

## Errors

| Error | Raised when |
|---|---|
| `InvalidOutboxOptionsError` | An option, a migration timestamp or a registration is invalid; `type` and `aggregateType` must be non-empty and at most 255 characters |
| `DuplicateOutboxRegistrationError` | An event class is registered twice |
| `OutboxMappingError` | A mapper throws, `aggregateId` returns anything but a non-empty string of at most 255 characters, or the payload cannot be serialized to JSON. The transaction rolls back |
| `UnsupportedDriverError` | The outbox writes, or the migration runs, on a driver other than Postgres |

All four extend `OutboxError`.

## Licence

MIT
