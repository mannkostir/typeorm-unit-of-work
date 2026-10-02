import { describe, expect, it } from 'vitest';
import { OutboxMappingError } from '../../src/errors/outbox-errors';
import { mapEventToRow } from '../../src/map-event-to-row';
import type { OutboxEventMapping } from '../../src/outbox-event-mapping';
import { OrderShipped } from './support/order-events';

const shippedAt = new Date('2026-10-02T10:00:00.000Z');
const event = new OrderShipped('o-1', shippedAt);

const mapping: OutboxEventMapping<OrderShipped> = {
  type: 'order.shipped',
  aggregateType: 'order',
  aggregateId: (shipped) => shipped.orderId,
};

describe('mapEventToRow', () => {
  it('maps type, aggregate type, aggregate id and the mapped payload', () => {
    const row = mapEventToRow(event, { ...mapping, payload: (shipped) => ({ id: shipped.orderId }) });

    expect(row).toEqual({ type: 'order.shipped', aggregateType: 'order', aggregateId: 'o-1', payload: '{"id":"o-1"}' });
  });

  it('serializes the event itself when no payload mapper is given, dates as ISO strings', () => {
    expect(mapEventToRow(event, mapping).payload).toBe('{"orderId":"o-1","shippedAt":"2026-10-02T10:00:00.000Z"}');
  });

  it('keeps a null payload as null', () => {
    expect(mapEventToRow(event, { ...mapping, payload: () => null }).payload).toBeNull();
  });

  it('accepts an aggregate id of 255 characters counted by code point', () => {
    const aggregateId = '😀'.repeat(255);

    expect(mapEventToRow(event, { ...mapping, aggregateId: () => aggregateId }).aggregateId).toBe(aggregateId);
  });

  it('wraps an aggregateId mapper that throws', () => {
    const cause = new Error('no id');

    expect(() =>
      mapEventToRow(event, {
        ...mapping,
        aggregateId: () => {
          throw cause;
        },
      }),
    ).toThrow(expect.objectContaining({ eventType: 'order.shipped', cause }));
  });

  it.each([[''], ['x'.repeat(256)], [42]])('rejects the aggregate id %j', (aggregateId) => {
    expect(() => mapEventToRow(event, { ...mapping, aggregateId: () => aggregateId as string })).toThrow(
      new OutboxMappingError('order.shipped', 'aggregateId must return a non-empty string of at most 255 characters'),
    );
  });

  it('wraps a payload mapper that throws', () => {
    const cause = new Error('bad payload');

    expect(() =>
      mapEventToRow(event, {
        ...mapping,
        payload: () => {
          throw cause;
        },
      }),
    ).toThrow(new OutboxMappingError('order.shipped', 'payload threw'));
  });

  it('rejects a payload JSON cannot serialize', () => {
    expect(() => mapEventToRow(event, { ...mapping, payload: () => ({ total: 10n }) })).toThrow(
      new OutboxMappingError('order.shipped', 'payload is not serializable to JSON'),
    );
  });

  it('rejects a payload that serializes to nothing', () => {
    expect(() => mapEventToRow(event, { ...mapping, payload: () => undefined })).toThrow(
      new OutboxMappingError('order.shipped', 'payload must return a JSON value or null'),
    );
  });
});
