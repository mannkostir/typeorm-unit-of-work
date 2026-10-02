import type { DomainEventPublisher } from 'typeorm-unit-of-work';

export const silentPublisher: DomainEventPublisher = {
  beforeCommit: async () => {},
  afterCommit: async () => {},
};
