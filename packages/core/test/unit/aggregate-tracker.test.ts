import { describe, expect, it } from 'vitest';
import { AggregateTracker } from '../../src/scope/aggregate-tracker';
import { Raised, TestAggregate } from './support/test-aggregate';

describe('AggregateTracker', () => {
  it('pulls pending events of tracked aggregates in tracking order', () => {
    const tracker = new AggregateTracker();
    const first = new TestAggregate();
    const second = new TestAggregate();
    first.raise('a');
    second.raise('b');
    tracker.track(first);
    tracker.track(second);

    expect(tracker.pullPendingEvents()).toEqual([new Raised('a'), new Raised('b')]);
  });

  it('pulls events of an aggregate tracked twice only once', () => {
    const tracker = new AggregateTracker();
    const aggregate = new TestAggregate();
    aggregate.raise('a');
    tracker.track(aggregate);
    tracker.track(aggregate);

    expect(tracker.pullPendingEvents()).toEqual([new Raised('a')]);
  });

  it('empties pending events once pulled', () => {
    const tracker = new AggregateTracker();
    const aggregate = new TestAggregate();
    aggregate.raise('a');
    tracker.track(aggregate);
    tracker.pullPendingEvents();

    expect(tracker.pullPendingEvents()).toEqual([]);
  });

  it('returns held events before events raised later', () => {
    const tracker = new AggregateTracker();
    const aggregate = new TestAggregate();
    tracker.track(aggregate);
    aggregate.raise('before');
    tracker.holdPendingEvents();
    aggregate.raise('after');

    expect(tracker.pullPendingEvents()).toEqual([new Raised('before'), new Raised('after')]);
  });

  it('drops held and pending events when discarding', () => {
    const tracker = new AggregateTracker();
    const aggregate = new TestAggregate();
    tracker.track(aggregate);
    aggregate.raise('held');
    tracker.holdPendingEvents();
    aggregate.raise('pending');
    tracker.discardPendingEvents();

    expect(tracker.pullPendingEvents()).toEqual([]);
  });

  it('adopts the aggregates and held events of another tracker', () => {
    const parent = new AggregateTracker();
    const child = new AggregateTracker();
    const aggregate = new TestAggregate();
    child.track(aggregate);
    aggregate.raise('held in child');
    child.holdPendingEvents();
    aggregate.raise('pending in child');
    parent.adopt(child);

    expect(parent.pullPendingEvents()).toEqual([new Raised('held in child'), new Raised('pending in child')]);
  });
});
