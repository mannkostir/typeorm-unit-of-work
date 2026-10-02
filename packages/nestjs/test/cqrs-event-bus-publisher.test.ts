import { InProcessEventPublisher } from 'typeorm-unit-of-work';
import { describe, expect, it, vi } from 'vitest';
import { CqrsEventBusPublisher } from '../src/cqrs-event-bus-publisher';

class OrderPlaced {
  constructor(readonly orderId: string) {}
}

describe('CqrsEventBusPublisher', () => {
  it('publishes each committed event to the event bus', async () => {
    const eventBus = { publish: vi.fn() };
    const publisher = new CqrsEventBusPublisher(eventBus);

    await publisher.afterCommit([new OrderPlaced('o-1'), new OrderPlaced('o-2')], vi.fn());

    expect(eventBus.publish.mock.calls).toEqual([[new OrderPlaced('o-1')], [new OrderPlaced('o-2')]]);
  });

  it('reports an event the bus fails to publish and publishes the rest', async () => {
    const failure = new Error('bus closed');
    const eventBus = { publish: vi.fn().mockRejectedValueOnce(failure) };
    const reportError = vi.fn();
    const publisher = new CqrsEventBusPublisher(eventBus);

    await publisher.afterCommit([new OrderPlaced('o-1'), new OrderPlaced('o-2')], reportError);

    expect({ reported: reportError.mock.calls, published: eventBus.publish.mock.calls.length }).toEqual({
      reported: [[failure, new OrderPlaced('o-1')]],
      published: 2,
    });
  });

  it('runs in-process after-commit handlers before publishing to the bus', async () => {
    const calls: string[] = [];
    const inProcess = new InProcessEventPublisher();
    inProcess.onAfterCommit(OrderPlaced, () => {
      calls.push('in-process');
    });
    const publisher = new CqrsEventBusPublisher(
      {
        publish: () => {
          calls.push('bus');
        },
      },
      inProcess,
    );

    await publisher.afterCommit([new OrderPlaced('o-1')], vi.fn());

    expect(calls).toEqual(['in-process', 'bus']);
  });

  it('delegates before-commit events to the in-process publisher', async () => {
    const inProcess = new InProcessEventPublisher();
    const handler = vi.fn();
    inProcess.onBeforeCommit(OrderPlaced, handler);
    const publisher = new CqrsEventBusPublisher({ publish: vi.fn() }, inProcess);
    const context = { manager: undefined, getRepository: vi.fn() } as never;

    await publisher.beforeCommit([new OrderPlaced('o-1')], context);

    expect(handler).toHaveBeenCalledWith(new OrderPlaced('o-1'), context);
  });
});
