import type { MigrationInterface } from 'typeorm';
import type { DomainEventPublisher } from 'typeorm-unit-of-work';
import { describe, expect, expectTypeOf, it } from 'vitest';
import * as api from '../../src/index';
import { createOutboxMigration, OutboxEventPublisher } from '../../src/index';
import type { OutboxEventPublisherOptions, OutboxRowRetention } from '../../src/index';
import { OrderShipped } from './support/order-events';
import { silentPublisher } from './support/silent-publisher';

describe('public API', () => {
  it('exports exactly the documented runtime values', () => {
    expect(Object.keys(api).sort()).toEqual([
      'DuplicateOutboxRegistrationError',
      'InvalidOutboxOptionsError',
      'OutboxError',
      'OutboxEventPublisher',
      'OutboxMappingError',
      'UnsupportedDriverError',
      'createOutboxMigration',
    ]);
  });

  it('is a publisher the unit of work accepts', () => {
    expectTypeOf<OutboxEventPublisher>().toExtend<DomainEventPublisher>();
  });

  it('infers the event type for every mapper from the registered class', () => {
    const outbox = new OutboxEventPublisher({ inner: silentPublisher });

    outbox.register(OrderShipped, {
      type: 'order.shipped',
      aggregateType: 'order',
      aggregateId: (event) => {
        expectTypeOf(event).toEqualTypeOf<OrderShipped>();
        return event.orderId;
      },
      payload: (event) => {
        expectTypeOf(event).toEqualTypeOf<OrderShipped>();
        return null;
      },
    });
  });

  it('offers exactly two row retentions', () => {
    expectTypeOf<OutboxRowRetention>().toEqualTypeOf<'delete' | 'retain'>();
    expectTypeOf<OutboxEventPublisherOptions['rows']>().toEqualTypeOf<OutboxRowRetention | undefined>();
  });

  it('returns a TypeORM migration class', () => {
    expectTypeOf(createOutboxMigration).returns.toEqualTypeOf<new () => MigrationInterface>();
  });
});
