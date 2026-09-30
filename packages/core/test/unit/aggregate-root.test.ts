import { describe, expect, it } from 'vitest';
import { AggregateRoot } from '../../src/events/aggregate-root';
import { isDomainEventSource } from '../../src/events/domain-event-source';

class OrderPlaced {
  constructor(readonly orderId: string) {}
}

class Order extends AggregateRoot {
  place(id: string): void {
    this.addDomainEvent(new OrderPlaced(id));
  }
}

describe('AggregateRoot', () => {
  it('returns raised events in the order they were raised', () => {
    const order = new Order();
    order.place('o-1');
    order.place('o-2');

    expect(order.pullDomainEvents()).toEqual([new OrderPlaced('o-1'), new OrderPlaced('o-2')]);
  });

  it('empties its pending events when they are pulled', () => {
    const order = new Order();
    order.place('o-1');
    order.pullDomainEvents();

    expect(order.pullDomainEvents()).toEqual([]);
  });

  it('raises events on an instance created without its constructor', () => {
    const order: Order = Object.create(Order.prototype);
    order.place('o-1');

    expect(order.pullDomainEvents()).toEqual([new OrderPlaced('o-1')]);
  });

  it('keeps pending events out of the enumerable properties', () => {
    const order = new Order();
    order.place('o-1');

    expect(Object.keys(order)).toEqual([]);
  });
});

describe('isDomainEventSource', () => {
  it('recognises an object with pullDomainEvents', () => {
    expect(isDomainEventSource({ pullDomainEvents: () => [] })).toBe(true);
  });

  it.each([null, undefined, 'order', { pullDomainEvents: [] }])('rejects %s', (value) => {
    expect(isDomainEventSource(value)).toBe(false);
  });
});
