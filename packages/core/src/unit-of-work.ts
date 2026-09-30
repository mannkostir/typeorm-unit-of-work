import type { EntityManager, EntityTarget, ObjectLiteral, Repository } from 'typeorm';
import { ScopeNotActiveError } from './errors/unit-of-work-errors';
import { JoinPropagation } from './propagation/join-propagation';
import { NewPropagation } from './propagation/new-propagation';
import type { PropagationStrategy, TransactionalWork } from './propagation/propagation-strategy';
import { ScopeRegistry } from './scope/scope-registry';
import { ScopeStore } from './scope/scope-store';
import { RootTransaction } from './transaction/root-transaction';
import {
  type Propagation,
  type ResolvedUnitOfWorkOptions,
  type RunOptions,
  resolveRunOptions,
  resolveUnitOfWorkOptions,
  type UnitOfWorkOptions,
} from './unit-of-work-options';

export class UnitOfWork {
  private readonly settings: ResolvedUnitOfWorkOptions;
  private readonly store = new ScopeStore();
  private readonly strategies: Readonly<Record<Propagation, PropagationStrategy>>;

  constructor(options: UnitOfWorkOptions) {
    this.settings = resolveUnitOfWorkOptions(options);
    const root = new RootTransaction({
      dataSource: this.settings.dataSource,
      store: this.store,
      registry: new ScopeRegistry(),
    });
    this.strategies = {
      join: new JoinPropagation(this.store, root),
      new: new NewPropagation(root),
    };
  }

  get manager(): EntityManager {
    const scope = this.store.current();
    if (scope !== undefined) {
      return scope.context.manager;
    }
    if (this.settings.strict) {
      throw new ScopeNotActiveError('uow.manager');
    }
    return this.settings.dataSource.manager;
  }

  getRepository<Entity extends ObjectLiteral>(target: EntityTarget<Entity>): Repository<Entity> {
    return this.manager.getRepository(target);
  }

  async run<Result>(work: TransactionalWork<Result>, options?: RunOptions<Result>): Promise<Result> {
    const resolved = resolveRunOptions(options);
    return this.strategies[resolved.propagation].run(work, resolved);
  }
}
