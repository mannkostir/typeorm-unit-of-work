import { describe, expect, it } from 'vitest';
import { InvalidOutboxOptionsError } from '../../src/errors/outbox-errors';
import { type OutboxEventPublisherOptions, resolveOutboxOptions } from '../../src/outbox-options';
import { silentPublisher } from './support/silent-publisher';

describe('resolveOutboxOptions', () => {
  it('deletes rows by default', () => {
    expect(resolveOutboxOptions({ inner: silentPublisher }).rows).toBe('delete');
  });

  it('writes to the outbox table by default', () => {
    expect(resolveOutboxOptions({ inner: silentPublisher }).table.quotedName).toBe('"outbox"');
  });

  it('keeps the configured table and retention', () => {
    const resolved = resolveOutboxOptions({ inner: silentPublisher, table: 'app.events', rows: 'retain' });

    expect([resolved.table.quotedName, resolved.rows]).toEqual(['"app"."events"', 'retain']);
  });

  it('rejects a missing inner publisher', () => {
    const options = {} as OutboxEventPublisherOptions;

    expect(() => resolveOutboxOptions(options)).toThrow(
      new InvalidOutboxOptionsError(
        'inner',
        'must implement beforeCommit(events, context) and afterCommit(events, reportError)',
      ),
    );
  });

  it('rejects an unknown retention', () => {
    const options = { inner: silentPublisher, rows: 'keep' } as unknown as OutboxEventPublisherOptions;

    expect(() => resolveOutboxOptions(options)).toThrow(
      new InvalidOutboxOptionsError('rows', 'must be one of delete, retain'),
    );
  });

  it('rejects an invalid table name', () => {
    expect(() => resolveOutboxOptions({ inner: silentPublisher, table: 'outbox;' })).toThrow(InvalidOutboxOptionsError);
  });
});
