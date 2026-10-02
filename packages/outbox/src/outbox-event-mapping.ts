export interface OutboxEventMapping<Event extends object> {
  readonly type: string;
  readonly aggregateType: string;
  readonly aggregateId: (event: Event) => string;
  readonly payload?: (event: Event) => unknown;
}
