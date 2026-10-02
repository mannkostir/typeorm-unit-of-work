import { beforeEach, describe, expect, it } from 'vitest';
import { DuplicateOutboxRegistrationError, InvalidOutboxOptionsError } from '../../src/errors/outbox-errors';
import type { OutboxEventMapping } from '../../src/outbox-event-mapping';
import { OutboxRegistry } from '../../src/outbox-registry';
import { ExpressOrderShipped, OrderCancelled, OrderShipped } from './support/order-events';

const shippedAt = new Date('2026-10-02T10:00:00.000Z');

const shippedMapping: OutboxEventMapping<OrderShipped> = {
  type: 'order.shipped',
  aggregateType: 'order',
  aggregateId: (event) => event.orderId,
  payload: () => null,
};

describe('OutboxRegistry', () => {
  let registry: OutboxRegistry;

  beforeEach(() => {
    registry = new OutboxRegistry();
  });

  it('maps a registered event', () => {
    registry.register(OrderShipped, shippedMapping);

    expect(registry.rowsFor([new OrderShipped('o-1', shippedAt)])).toEqual([
      { type: 'order.shipped', aggregateType: 'order', aggregateId: 'o-1', payload: null },
    ]);
  });

  it('skips unregistered events and keeps the order of the rest', () => {
    registry.register(OrderShipped, shippedMapping);

    const rows = registry.rowsFor([
      new OrderShipped('o-1', shippedAt),
      new OrderCancelled('o-2'),
      new OrderShipped('o-3', shippedAt),
    ]);

    expect(rows.map((row) => row.aggregateId)).toEqual(['o-1', 'o-3']);
  });

  it('skips plain-object and null-prototype events', () => {
    registry.register(OrderShipped, shippedMapping);

    expect(registry.rowsFor([{ orderId: 'o-1' }, Object.create(null) as object])).toEqual([]);
  });

  it('matches a subclass event through its base class registration', () => {
    registry.register(OrderShipped, shippedMapping);

    expect(registry.rowsFor([new ExpressOrderShipped('o-1', shippedAt)])[0]?.type).toBe('order.shipped');
  });

  it('prefers the subclass registration over the base class registration', () => {
    registry.register(OrderShipped, shippedMapping);
    registry.register(ExpressOrderShipped, { ...shippedMapping, type: 'order.shipped.express' });

    expect(registry.rowsFor([new ExpressOrderShipped('o-1', shippedAt)])[0]?.type).toBe('order.shipped.express');
  });

  it('rejects registering the same class twice', () => {
    registry.register(OrderShipped, shippedMapping);

    expect(() => registry.register(OrderShipped, shippedMapping)).toThrow(
      new DuplicateOutboxRegistrationError('OrderShipped'),
    );
  });

  it('rejects an empty type', () => {
    expect(() => registry.register(OrderShipped, { ...shippedMapping, type: '' })).toThrow(
      new InvalidOutboxOptionsError('type', 'must be a non-empty string of at most 255 characters (registering OrderShipped)'),
    );
  });

  it('rejects an aggregate type longer than 255 characters', () => {
    expect(() => registry.register(OrderShipped, { ...shippedMapping, aggregateType: 'a'.repeat(256) })).toThrow(
      new InvalidOutboxOptionsError('aggregateType', 'must be a non-empty string of at most 255 characters (registering OrderShipped)'),
    );
  });

  it('rejects an aggregateId that is not a function', () => {
    const mapping = { ...shippedMapping, aggregateId: 'orderId' } as unknown as OutboxEventMapping<OrderShipped>;

    expect(() => registry.register(OrderShipped, mapping)).toThrow(
      new InvalidOutboxOptionsError('aggregateId', 'must be a function that returns the aggregate id of the event (registering OrderShipped)'),
    );
  });

  it('rejects a payload that is not a function', () => {
    const mapping = { ...shippedMapping, payload: {} } as unknown as OutboxEventMapping<OrderShipped>;

    expect(() => registry.register(OrderShipped, mapping)).toThrow(
      new InvalidOutboxOptionsError('payload', 'must be a function that returns the payload of the event (registering OrderShipped)'),
    );
  });
});
