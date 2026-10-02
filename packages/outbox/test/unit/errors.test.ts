import { describe, expect, it } from 'vitest';
import {
  DuplicateOutboxRegistrationError,
  InvalidOutboxOptionsError,
  OutboxError,
  OutboxMappingError,
  UnsupportedDriverError,
} from '../../src/errors/outbox-errors';

describe('outbox errors', () => {
  it('names each error after its class', () => {
    expect(new UnsupportedDriverError('mysql').name).toBe('UnsupportedDriverError');
  });

  it('makes every outbox error an OutboxError', () => {
    expect(new DuplicateOutboxRegistrationError('OrderShipped')).toBeInstanceOf(OutboxError);
  });

  it('names the invalid option and the reason', () => {
    const error = new InvalidOutboxOptionsError('rows', 'must be one of delete, retain');

    expect(error).toMatchObject({ option: 'rows', message: 'Invalid outbox option "rows": must be one of delete, retain' });
  });

  it('names the class registered twice', () => {
    const error = new DuplicateOutboxRegistrationError('OrderShipped');

    expect(error).toMatchObject({
      eventClassName: 'OrderShipped',
      message: 'OrderShipped is already registered with the outbox; register each event class once',
    });
  });

  it('names the event type and keeps the cause of a mapping failure', () => {
    const cause = new Error('no order id');

    const error = new OutboxMappingError('order.shipped', 'aggregateId threw', { cause });

    expect(error).toMatchObject({
      eventType: 'order.shipped',
      cause,
      message: 'Could not map an event to an outbox row of type "order.shipped": aggregateId threw',
    });
  });

  it('names the unsupported driver', () => {
    const error = new UnsupportedDriverError('better-sqlite3');

    expect(error).toMatchObject({
      driverType: 'better-sqlite3',
      message: 'The outbox writes to Postgres only, but the DataSource uses the better-sqlite3 driver',
    });
  });
});
