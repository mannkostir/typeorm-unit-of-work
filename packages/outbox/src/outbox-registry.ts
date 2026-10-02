import type { EventClass } from 'typeorm-unit-of-work';
import { fitsColumn, maxColumnCharacters } from './column-value';
import { DuplicateOutboxRegistrationError, InvalidOutboxOptionsError } from './errors/outbox-errors';
import { mapEventToRow } from './map-event-to-row';
import type { OutboxEventMapping } from './outbox-event-mapping';
import type { OutboxRowContent } from './outbox-row';

type RowMapper = (event: object) => OutboxRowContent | undefined;

export class OutboxRegistry {
  readonly #mappersByPrototype = new Map<unknown, RowMapper>();

  register<Event extends object>(eventClass: EventClass<Event>, mapping: OutboxEventMapping<Event>): void {
    assertValidMapping(mapping);
    const prototype: unknown = eventClass.prototype;
    if (this.#mappersByPrototype.has(prototype)) {
      throw new DuplicateOutboxRegistrationError(eventClass.name);
    }
    this.#mappersByPrototype.set(prototype, (event) =>
      event instanceof eventClass ? mapEventToRow(event, mapping) : undefined,
    );
  }

  rowsFor(events: readonly object[]): OutboxRowContent[] {
    return events.flatMap((event) => {
      const row = this.#mapperFor(event)?.(event);
      return row === undefined ? [] : [row];
    });
  }

  #mapperFor(event: object): RowMapper | undefined {
    let prototype: unknown = Object.getPrototypeOf(event);
    while (prototype !== null) {
      const mapper = this.#mappersByPrototype.get(prototype);
      if (mapper !== undefined) {
        return mapper;
      }
      prototype = Object.getPrototypeOf(prototype);
    }
    return undefined;
  }
}

function assertValidMapping<Event extends object>(mapping: OutboxEventMapping<Event>): void {
  const columnRule = `must be a non-empty string of at most ${maxColumnCharacters} characters`;
  if (!fitsColumn(mapping.type)) {
    throw new InvalidOutboxOptionsError('type', columnRule);
  }
  if (!fitsColumn(mapping.aggregateType)) {
    throw new InvalidOutboxOptionsError('aggregateType', columnRule);
  }
  if (typeof mapping.aggregateId !== 'function') {
    throw new InvalidOutboxOptionsError('aggregateId', 'must be a function that returns the aggregate id of the event');
  }
  if (mapping.payload !== undefined && typeof mapping.payload !== 'function') {
    throw new InvalidOutboxOptionsError('payload', 'must be a function that returns the payload of the event');
  }
}
