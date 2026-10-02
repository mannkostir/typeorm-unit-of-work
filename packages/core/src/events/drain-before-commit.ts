import { EventCascadeLimitExceededError } from '../errors/unit-of-work-errors';

export interface PendingEventSource {
  pullPendingEvents(): readonly object[];
}

export async function drainBeforeCommit(
  source: PendingEventSource,
  publish: (events: readonly object[]) => Promise<void>,
  maxRounds: number,
): Promise<readonly object[]> {
  const drained: object[] = [];
  for (let round = 1; ; round += 1) {
    const events = source.pullPendingEvents();
    if (events.length === 0) {
      return drained;
    }
    if (round > maxRounds) {
      throw new EventCascadeLimitExceededError(
        maxRounds,
        events.map((event) => event.constructor.name),
      );
    }
    await publish(events);
    drained.push(...events);
  }
}
