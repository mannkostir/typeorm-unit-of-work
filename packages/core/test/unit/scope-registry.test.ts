import { describe, expect, it } from 'vitest';
import { ScopeRegistry } from '../../src/scope/scope-registry';
import { TransactionScope } from '../../src/scope/transaction-scope';
import { unusedDataSource } from './support/unused-context';

describe('ScopeRegistry', () => {
  it('finds nothing for an unbound query runner', () => {
    expect(new ScopeRegistry().find(unusedDataSource.createQueryRunner())).toBeUndefined();
  });

  it('finds the scope bound to a query runner while the work runs', async () => {
    const registry = new ScopeRegistry();
    const queryRunner = unusedDataSource.createQueryRunner();
    const scope = new TransactionScope(queryRunner);

    const seen = await registry.withBinding(queryRunner, scope, async () => registry.find(queryRunner));

    expect(seen).toBe(scope);
  });

  it('removes the binding after the work', async () => {
    const registry = new ScopeRegistry();
    const queryRunner = unusedDataSource.createQueryRunner();

    await registry.withBinding(queryRunner, new TransactionScope(queryRunner), async () => undefined);

    expect(registry.find(queryRunner)).toBeUndefined();
  });

  it('removes the binding after the work fails', async () => {
    const registry = new ScopeRegistry();
    const queryRunner = unusedDataSource.createQueryRunner();
    const failing = registry.withBinding(queryRunner, new TransactionScope(queryRunner), async () => {
      throw new Error('failed');
    });

    await expect(failing).rejects.toThrow('failed');
    expect(registry.find(queryRunner)).toBeUndefined();
  });

  it('restores the outer binding after a nested binding on the same query runner', async () => {
    const registry = new ScopeRegistry();
    const queryRunner = unusedDataSource.createQueryRunner();
    const outer = new TransactionScope(queryRunner);

    const seen = await registry.withBinding(queryRunner, outer, async () => {
      await registry.withBinding(queryRunner, new TransactionScope(queryRunner), async () => undefined);
      return registry.find(queryRunner);
    });

    expect(seen).toBe(outer);
  });
});
