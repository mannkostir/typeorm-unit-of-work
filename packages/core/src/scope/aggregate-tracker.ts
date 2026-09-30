import type { DomainEventSource } from '../events/domain-event-source';

export class AggregateTracker {
  readonly #aggregates = new Set<DomainEventSource>();
  #heldEvents: readonly object[] = [];

  track(aggregate: DomainEventSource): void {
    this.#aggregates.add(aggregate);
  }

  holdPendingEvents(): void {
    this.#heldEvents = [...this.#heldEvents, ...this.#pullFromAggregates()];
  }

  pullPendingEvents(): readonly object[] {
    const events = [...this.#heldEvents, ...this.#pullFromAggregates()];
    this.#heldEvents = [];
    return events;
  }

  discardPendingEvents(): void {
    this.#pullFromAggregates();
    this.#heldEvents = [];
  }

  adopt(other: AggregateTracker): void {
    for (const aggregate of other.#aggregates) {
      this.#aggregates.add(aggregate);
    }
    this.#heldEvents = [...this.#heldEvents, ...other.#heldEvents];
  }

  #pullFromAggregates(): readonly object[] {
    return [...this.#aggregates].flatMap((aggregate) => aggregate.pullDomainEvents());
  }
}
