import { describe, expect, it, vi } from 'vitest';
import { EventCascadeLimitExceededError } from '../../src/errors/unit-of-work-errors';
import { drainBeforeCommit } from '../../src/events/drain-before-commit';
import { AggregateTracker } from '../../src/scope/aggregate-tracker';
import { Raised, TestAggregate } from './support/test-aggregate';

function trackedAggregate(): { tracker: AggregateTracker; aggregate: TestAggregate } {
  const tracker = new AggregateTracker();
  const aggregate = new TestAggregate();
  tracker.track(aggregate);
  return { tracker, aggregate };
}

describe('drainBeforeCommit', () => {
  it('returns no events and publishes nothing when nothing is pending', async () => {
    const { tracker } = trackedAggregate();
    const publish = vi.fn(async () => undefined);

    const drained = await drainBeforeCommit(tracker, publish, 100);

    expect({ drained, publishCalls: publish.mock.calls.length }).toEqual({ drained: [], publishCalls: 0 });
  });

  it('publishes events raised by handlers in later rounds and returns all of them in order', async () => {
    const { tracker, aggregate } = trackedAggregate();
    aggregate.raise('placed');
    const publish = vi
      .fn(async (_events: readonly object[]): Promise<void> => undefined)
      .mockImplementationOnce(async () => aggregate.raise('reserved'));

    const drained = await drainBeforeCommit(tracker, publish, 100);

    expect({ drained, batches: publish.mock.calls.map(([events]) => events) }).toEqual({
      drained: [new Raised('placed'), new Raised('reserved')],
      batches: [[new Raised('placed')], [new Raised('reserved')]],
    });
  });

  it('throws when handlers are still raising events after the round limit', async () => {
    const { tracker, aggregate } = trackedAggregate();
    aggregate.raise('ping');
    const publish = vi.fn(async () => aggregate.raise('pong'));

    await expect(drainBeforeCommit(tracker, publish, 2)).rejects.toEqual(
      new EventCascadeLimitExceededError(2, ['Raised']),
    );
  });
});
