import type { DomainEventPublisher } from 'typeorm-unit-of-work';
import { InvalidOutboxOptionsError } from './errors/outbox-errors';
import { OutboxTable } from './outbox-table';

export type OutboxRowRetention = 'delete' | 'retain';

export interface OutboxEventPublisherOptions {
  readonly inner: DomainEventPublisher;
  readonly table?: string;
  readonly rows?: OutboxRowRetention;
}

export interface ResolvedOutboxOptions {
  readonly inner: DomainEventPublisher;
  readonly table: OutboxTable;
  readonly rows: OutboxRowRetention;
}

const retentions: readonly OutboxRowRetention[] = ['delete', 'retain'];

export function resolveOutboxOptions(options: OutboxEventPublisherOptions): ResolvedOutboxOptions {
  if (!isDomainEventPublisher(options.inner)) {
    throw new InvalidOutboxOptionsError(
      'inner',
      'must implement beforeCommit(events, context) and afterCommit(events, reportError)',
    );
  }
  const rows = options.rows ?? 'delete';
  if (!retentions.includes(rows)) {
    throw new InvalidOutboxOptionsError('rows', `must be one of ${retentions.join(', ')}`);
  }
  return { inner: options.inner, table: OutboxTable.named(options.table ?? 'outbox'), rows };
}

function isDomainEventPublisher(value: unknown): value is DomainEventPublisher {
  return (
    typeof value === 'object' &&
    value !== null &&
    'beforeCommit' in value &&
    typeof value.beforeCommit === 'function' &&
    'afterCommit' in value &&
    typeof value.afterCommit === 'function'
  );
}
