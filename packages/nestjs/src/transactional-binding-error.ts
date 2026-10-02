import { UnitOfWorkError } from 'typeorm-unit-of-work';

export class TransactionalBindingError extends UnitOfWorkError {
  constructor(className: string, methodName: string, reason: string) {
    super(`@Transactional() on ${className}.${methodName} cannot be bound: ${reason}`);
  }
}
