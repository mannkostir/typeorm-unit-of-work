import { setTimeout } from 'node:timers/promises';
import { describe, expect, it } from 'vitest';
import { ScopeStore } from '../../src/scope/scope-store';
import { TransactionScope } from '../../src/scope/transaction-scope';
import { unusedDataSource } from './support/unused-context';

function newScope(): TransactionScope {
  return new TransactionScope(unusedDataSource.createQueryRunner());
}

describe('ScopeStore', () => {
  it('has no current scope outside runIn', () => {
    expect(new ScopeStore().current()).toBeUndefined();
  });

  it('exposes the scope inside runIn across awaits', async () => {
    const store = new ScopeStore();
    const scope = newScope();

    const seen = await store.runIn(scope, async () => {
      await setTimeout(1);
      return store.current();
    });

    expect(seen).toBe(scope);
  });

  it('restores the outer scope after a nested runIn', async () => {
    const store = new ScopeStore();
    const outer = newScope();

    const seen = await store.runIn(outer, async () => {
      await store.runIn(newScope(), async () => undefined);
      return store.current();
    });

    expect(seen).toBe(outer);
  });

  it('hides the scope inside runDetached', async () => {
    const store = new ScopeStore();

    const seen = await store.runIn(newScope(), () => store.runDetached(async () => store.current()));

    expect(seen).toBeUndefined();
  });

  it('keeps concurrent runs apart', async () => {
    const store = new ScopeStore();
    const first = newScope();
    const second = newScope();

    const seen = await Promise.all([
      store.runIn(first, async () => {
        await setTimeout(5);
        return store.current();
      }),
      store.runIn(second, async () => {
        await setTimeout(1);
        return store.current();
      }),
    ]);

    expect(seen).toEqual([first, second]);
  });

  it('keeps separate stores apart', async () => {
    const store = new ScopeStore();
    const other = new ScopeStore();

    const seen = await store.runIn(newScope(), async () => other.current());

    expect(seen).toBeUndefined();
  });
});
