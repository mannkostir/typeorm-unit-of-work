import type { TransactionContext } from '../transaction-context';
import type { AfterCommitErrorHandler, DomainEventPublisher } from './domain-event-publisher';

export type EventClass<Event extends object> = abstract new (...args: never[]) => Event;

export type BeforeCommitHandler<Event extends object> = (
  event: Event,
  context: TransactionContext,
) => Promise<void> | void;

export type AfterCommitHandler<Event extends object> = (event: Event) => Promise<void> | void;

type BeforeCommitDelivery = (event: object, context: TransactionContext) => Promise<void>;

type AfterCommitDelivery = (event: object) => Promise<void>;

export class InProcessEventPublisher implements DomainEventPublisher {
  readonly #beforeCommitDeliveries: BeforeCommitDelivery[] = [];
  readonly #afterCommitDeliveries: AfterCommitDelivery[] = [];

  onBeforeCommit<Event extends object>(eventClass: EventClass<Event>, handler: BeforeCommitHandler<Event>): void {
    this.#beforeCommitDeliveries.push(async (event, context) => {
      if (event instanceof eventClass) {
        await handler(event, context);
      }
    });
  }

  onAfterCommit<Event extends object>(eventClass: EventClass<Event>, handler: AfterCommitHandler<Event>): void {
    this.#afterCommitDeliveries.push(async (event) => {
      if (event instanceof eventClass) {
        await handler(event);
      }
    });
  }

  async beforeCommit(events: readonly object[], context: TransactionContext): Promise<void> {
    for (const event of events) {
      for (const deliver of this.#beforeCommitDeliveries) {
        await deliver(event, context);
      }
    }
  }

  async afterCommit(events: readonly object[], reportError: AfterCommitErrorHandler): Promise<void> {
    for (const event of events) {
      for (const deliver of this.#afterCommitDeliveries) {
        await deliverReportingFailure(deliver, event, reportError);
      }
    }
  }
}

async function deliverReportingFailure(
  deliver: AfterCommitDelivery,
  event: object,
  reportError: AfterCommitErrorHandler,
): Promise<void> {
  try {
    await deliver(event);
  } catch (error) {
    reportError(error, event);
  }
}
