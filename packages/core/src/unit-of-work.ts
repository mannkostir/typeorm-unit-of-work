import type { EntityManager, EntityTarget, ObjectLiteral, Repository } from 'typeorm';
import { ScopeNotActiveError } from './errors/unit-of-work-errors';
import type { DomainEventSource } from './events/domain-event-source';
import { JoinPropagation } from './propagation/join-propagation';
import { NestedPropagation } from './propagation/nested-propagation';
import { NewPropagation } from './propagation/new-propagation';
import type { PropagationStrategy, TransactionalWork } from './propagation/propagation-strategy';
import { ScopeStore } from './scope/scope-store';
import type { TransactionScope } from './scope/transaction-scope';
import { eventCollectionFor } from './subscriber/event-collection';
import { QueryRunnerRelease } from './transaction/query-runner-release';
import { RootTransaction } from './transaction/root-transaction';
import { SavepointTransaction } from './transaction/savepoint-transaction';
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
    const registry = eventCollectionFor(this.settings.dataSource);
    const root = new RootTransaction({
      dataSource: this.settings.dataSource,
      store: this.store,
      registry,
      publisher: this.settings.publisher,
      onAfterCommitError: this.settings.onAfterCommitError,
      maxEventRounds: this.settings.maxEventRounds,
      release: new QueryRunnerRelease(this.settings.discardConnection),
    });
    this.strategies = {
      join: new JoinPropagation(this.store, root),
      new: new NewPropagation(root),
      nested: new NestedPropagation(this.store, root, new SavepointTransaction(this.store, registry)),
    };
  }

  get manager(): EntityManager {
    return this.#managerFor('uow.manager');
  }

  getRepository<Entity extends ObjectLiteral>(target: EntityTarget<Entity>): Repository<Entity> {
    return this.#managerFor('uow.getRepository()').getRepository(target);
  }

  async run<Result>(work: TransactionalWork<Result>, options?: RunOptions<Result>): Promise<Result> {
    const resolved = resolveRunOptions(options);
    this.store.current()?.ensureOpen('uow.run()');
    return this.strategies[resolved.propagation].run(work, resolved);
  }

  track(aggregate: DomainEventSource): void {
    const scope = this.#openScope('uow.track()');
    if (scope === undefined) {
      throw new ScopeNotActiveError('uow.track()');
    }
    scope.aggregates.track(aggregate);
  }

  #managerFor(operation: string): EntityManager {
    const scope = this.#openScope(operation);
    if (scope !== undefined) {
      return scope.context.manager;
    }
    if (this.settings.strict) {
      throw new ScopeNotActiveError(operation);
    }
    return this.settings.dataSource.manager;
  }

  #openScope(operation: string): TransactionScope | undefined {
    const scope = this.store.current();
    scope?.ensureOpen(operation);
    return scope;
  }
}
