import { describe, expect, it, vi } from 'vitest';
import { InProcessEventPublisher } from '../../src/events/in-process-event-publisher';
import { unusedContext } from './support/unused-context';

class OrderPlaced {
  constructor(readonly orderId: string) {}
}

class ExpressOrderPlaced extends OrderPlaced {}

class OrderShipped {
  constructor(readonly orderId: string) {}
}

describe('InProcessEventPublisher before commit', () => {
  it('delivers an event to handlers registered for its class', async () => {
    const publisher = new InProcessEventPublisher();
    const handler = vi.fn();
    publisher.onBeforeCommit(OrderPlaced, handler);

    await publisher.beforeCommit([new OrderPlaced('o-1')], unusedContext);

    expect(handler).toHaveBeenCalledWith(new OrderPlaced('o-1'), unusedContext);
  });

  it('skips handlers registered for other classes', async () => {
    const publisher = new InProcessEventPublisher();
    const handler = vi.fn();
    publisher.onBeforeCommit(OrderShipped, handler);

    await publisher.beforeCommit([new OrderPlaced('o-1')], unusedContext);

    expect(handler).not.toHaveBeenCalled();
  });

  it('delivers subclass events to handlers of the base class', async () => {
    const publisher = new InProcessEventPublisher();
    const handler = vi.fn();
    publisher.onBeforeCommit(OrderPlaced, handler);

    await publisher.beforeCommit([new ExpressOrderPlaced('o-1')], unusedContext);

    expect(handler).toHaveBeenCalledOnce();
  });

  it('runs handlers per event in registration order', async () => {
    const publisher = new InProcessEventPublisher();
    const calls: string[] = [];
    publisher.onBeforeCommit(OrderPlaced, (event) => {
      calls.push(`first ${event.orderId}`);
    });
    publisher.onBeforeCommit(OrderPlaced, (event) => {
      calls.push(`second ${event.orderId}`);
    });

    await publisher.beforeCommit([new OrderPlaced('o-1'), new OrderPlaced('o-2')], unusedContext);

    expect(calls).toEqual(['first o-1', 'second o-1', 'first o-2', 'second o-2']);
  });

  it('stops at the first failing handler and rejects with its error', async () => {
    const publisher = new InProcessEventPublisher();
    const failure = new Error('stock check failed');
    const later = vi.fn();
    publisher.onBeforeCommit(OrderPlaced, () => {
      throw failure;
    });
    publisher.onBeforeCommit(OrderPlaced, later);

    await expect(publisher.beforeCommit([new OrderPlaced('o-1')], unusedContext)).rejects.toBe(failure);
    expect(later).not.toHaveBeenCalled();
  });
});

describe('InProcessEventPublisher after commit', () => {
  it('delivers an event to handlers registered for its class', async () => {
    const publisher = new InProcessEventPublisher();
    const handler = vi.fn();
    publisher.onAfterCommit(OrderPlaced, handler);

    await publisher.afterCommit([new OrderPlaced('o-1')], vi.fn());

    expect(handler).toHaveBeenCalledWith(new OrderPlaced('o-1'));
  });

  it('reports a failing handler and still runs the rest', async () => {
    const publisher = new InProcessEventPublisher();
    const failure = new Error('mailer down');
    const reportError = vi.fn();
    const later = vi.fn();
    publisher.onAfterCommit(OrderPlaced, () => {
      throw failure;
    });
    publisher.onAfterCommit(OrderPlaced, later);

    await publisher.afterCommit([new OrderPlaced('o-1')], reportError);

    expect({ reported: reportError.mock.calls, laterCalled: later.mock.calls.length }).toEqual({
      reported: [[failure, new OrderPlaced('o-1')]],
      laterCalled: 1,
    });
  });

  it('keeps before-commit and after-commit handlers apart', async () => {
    const publisher = new InProcessEventPublisher();
    const beforeCommitHandler = vi.fn();
    publisher.onBeforeCommit(OrderPlaced, beforeCommitHandler);

    await publisher.afterCommit([new OrderPlaced('o-1')], vi.fn());

    expect(beforeCommitHandler).not.toHaveBeenCalled();
  });
});
