export interface DomainEventSource {
  pullDomainEvents(): readonly object[];
}

export function isDomainEventSource(value: unknown): value is DomainEventSource {
  return (
    typeof value === 'object' &&
    value !== null &&
    'pullDomainEvents' in value &&
    typeof value.pullDomainEvents === 'function'
  );
}
