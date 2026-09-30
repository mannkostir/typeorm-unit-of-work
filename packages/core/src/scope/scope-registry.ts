import type { QueryRunner } from 'typeorm';
import type { TransactionScope } from './transaction-scope';

export class ScopeRegistry {
  readonly #scopes = new WeakMap<QueryRunner, TransactionScope>();

  find(queryRunner: QueryRunner): TransactionScope | undefined {
    return this.#scopes.get(queryRunner);
  }

  async withBinding<Value>(
    queryRunner: QueryRunner,
    scope: TransactionScope,
    work: () => Promise<Value>,
  ): Promise<Value> {
    const previous = this.#scopes.get(queryRunner);
    this.#scopes.set(queryRunner, scope);
    try {
      return await work();
    } finally {
      this.#restore(queryRunner, previous);
    }
  }

  #restore(queryRunner: QueryRunner, previous: TransactionScope | undefined): void {
    if (previous === undefined) {
      this.#scopes.delete(queryRunner);
      return;
    }
    this.#scopes.set(queryRunner, previous);
  }
}
