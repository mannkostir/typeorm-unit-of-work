import type {
  EntitySubscriberInterface,
  InsertEvent,
  QueryRunner,
  RemoveEvent,
  SoftRemoveEvent,
  UpdateEvent,
} from 'typeorm';
import { isDomainEventSource } from '../events/domain-event-source';
import type { ScopeRegistry } from '../scope/scope-registry';

export class EventCollectingSubscriber implements EntitySubscriberInterface {
  constructor(private readonly scopes: ScopeRegistry) {}

  afterInsert(event: InsertEvent<unknown>): void {
    this.#collect(event.queryRunner, event.entity);
  }

  afterUpdate(event: UpdateEvent<unknown>): void {
    this.#collect(event.queryRunner, event.entity);
  }

  afterRemove(event: RemoveEvent<unknown>): void {
    this.#collect(event.queryRunner, event.entity);
  }

  afterSoftRemove(event: SoftRemoveEvent<unknown>): void {
    this.#collect(event.queryRunner, event.entity);
  }

  #collect(queryRunner: QueryRunner, entity: unknown): void {
    if (!isDomainEventSource(entity)) {
      return;
    }
    this.scopes.find(queryRunner)?.trackSaved(entity);
  }
}
