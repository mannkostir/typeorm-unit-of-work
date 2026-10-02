import {
  type AfterCommitErrorHandler,
  type DomainEventPublisher,
  InProcessEventPublisher,
  type TransactionContext,
} from 'typeorm-unit-of-work';

export interface EventBusLike {
  publish(event: object): unknown;
}

export class CqrsEventBusPublisher implements DomainEventPublisher {
  constructor(
    private readonly eventBus: EventBusLike,
    private readonly inProcess: InProcessEventPublisher = new InProcessEventPublisher(),
  ) {}

  beforeCommit(events: readonly object[], context: TransactionContext): Promise<void> {
    return this.inProcess.beforeCommit(events, context);
  }

  async afterCommit(events: readonly object[], reportError: AfterCommitErrorHandler): Promise<void> {
    await this.inProcess.afterCommit(events, reportError);
    for (const event of events) {
      await this.#publishReportingFailure(event, reportError);
    }
  }

  async #publishReportingFailure(event: object, reportError: AfterCommitErrorHandler): Promise<void> {
    try {
      await this.eventBus.publish(event);
    } catch (error) {
      reportError(error, event);
    }
  }
}
