import { fitsColumn, maxColumnCharacters } from './column-value';
import { OutboxMappingError } from './errors/outbox-errors';
import type { OutboxEventMapping } from './outbox-event-mapping';
import type { OutboxRowContent } from './outbox-row';

export function mapEventToRow<Event extends object>(
  event: Event,
  mapping: OutboxEventMapping<Event>,
): OutboxRowContent {
  return {
    type: mapping.type,
    aggregateType: mapping.aggregateType,
    aggregateId: aggregateIdOf(event, mapping),
    payload: payloadOf(event, mapping),
  };
}

function aggregateIdOf<Event extends object>(event: Event, mapping: OutboxEventMapping<Event>): string {
  const aggregateId: unknown = attempt(mapping.type, 'aggregateId threw', () => mapping.aggregateId(event));
  if (!fitsColumn(aggregateId)) {
    throw new OutboxMappingError(
      mapping.type,
      `aggregateId must return a non-empty string of at most ${maxColumnCharacters} characters`,
    );
  }
  return aggregateId;
}

function payloadOf<Event extends object>(event: Event, mapping: OutboxEventMapping<Event>): string | null {
  const payload = attempt(mapping.type, 'payload threw', () =>
    mapping.payload === undefined ? event : mapping.payload(event),
  );
  if (payload === null) {
    return null;
  }
  const json: string | undefined = attempt(mapping.type, 'payload is not serializable to JSON', () =>
    JSON.stringify(payload),
  );
  if (json === undefined) {
    throw new OutboxMappingError(mapping.type, 'payload must return a JSON value or null');
  }
  return json;
}

function attempt<Result>(eventType: string, failure: string, step: () => Result): Result {
  try {
    return step();
  } catch (error) {
    throw new OutboxMappingError(eventType, failure, { cause: error });
  }
}
