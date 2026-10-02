import type { EntityManager, EntityTarget, ObjectLiteral, Repository } from 'typeorm';

export interface TransactionContext {
  readonly manager: EntityManager;
  getRepository<Entity extends ObjectLiteral>(target: EntityTarget<Entity>): Repository<Entity>;
}

export function transactionContextOf(manager: EntityManager): TransactionContext {
  return {
    manager,
    getRepository: <Entity extends ObjectLiteral>(target: EntityTarget<Entity>) => manager.getRepository(target),
  };
}
