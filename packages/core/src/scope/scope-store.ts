import { AsyncLocalStorage } from 'node:async_hooks';
import type { TransactionScope } from './transaction-scope';

export class ScopeStore {
  readonly #storage = new AsyncLocalStorage<TransactionScope | undefined>();

  current(): TransactionScope | undefined {
    return this.#storage.getStore();
  }

  runIn<Value>(scope: TransactionScope, work: () => Promise<Value>): Promise<Value> {
    return this.#storage.run(scope, work);
  }

  runDetached<Value>(work: () => Promise<Value>): Promise<Value> {
    return this.#storage.run(undefined, work);
  }
}
