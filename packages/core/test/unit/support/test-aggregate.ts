import { AggregateRoot } from '../../../src/events/aggregate-root';

export class Raised {
  constructor(readonly label: string) {}
}

export class TestAggregate extends AggregateRoot {
  raise(label: string): void {
    this.addDomainEvent(new Raised(label));
  }
}
