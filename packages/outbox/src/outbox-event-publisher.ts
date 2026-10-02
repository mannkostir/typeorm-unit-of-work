import { randomUUID } from 'node:crypto';
import type {
  AfterCommitErrorHandler,
  DomainEventPublisher,
  EventClass,
  TransactionContext,
} from 'typeorm-unit-of-work';
import type { OutboxEventMapping } from './outbox-event-mapping';
import { type OutboxEventPublisherOptions, resolveOutboxOptions } from './outbox-options';
import { OutboxRegistry } from './outbox-registry';
import type { OutboxRow, OutboxRowContent } from './outbox-row';
import { OutboxWriter } from './outbox-writer';

export class OutboxEventPublisher implements DomainEventPublisher {
  readonly #inner: DomainEventPublisher;
  readonly #registry = new OutboxRegistry();
  readonly #writer: OutboxWriter;

  constructor(options: OutboxEventPublisherOptions) {
    const resolved = resolveOutboxOptions(options);
    this.#inner = resolved.inner;
    this.#writer = new OutboxWriter(resolved.table, resolved.rows);
  }

  register<Event extends object>(eventClass: EventClass<Event>, mapping: OutboxEventMapping<Event>): void {
    this.#registry.register(eventClass, mapping);
  }

  async beforeCommit(events: readonly object[], context: TransactionContext): Promise<void> {
    await this.#inner.beforeCommit(events, context);
    const rows = this.#registry.rowsFor(events).map(withNewId);
    if (rows.length === 0) {
      return;
    }
    await this.#writer.write(context.manager, rows);
  }

  afterCommit(events: readonly object[], reportError: AfterCommitErrorHandler): Promise<void> {
    return this.#inner.afterCommit(events, reportError);
  }
}

function withNewId(content: OutboxRowContent): OutboxRow {
  return { id: randomUUID(), ...content };
}
