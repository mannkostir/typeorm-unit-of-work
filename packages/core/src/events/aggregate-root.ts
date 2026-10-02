import type { DomainEventSource } from './domain-event-source';

const pendingEventsByAggregate = new WeakMap<AggregateRoot, readonly object[]>();

export abstract class AggregateRoot implements DomainEventSource {
  pullDomainEvents(): readonly object[] {
    const events = pendingEventsByAggregate.get(this) ?? [];
    pendingEventsByAggregate.delete(this);
    return events;
  }

  protected addDomainEvent(event: object): void {
    pendingEventsByAggregate.set(this, [...(pendingEventsByAggregate.get(this) ?? []), event]);
  }
}
