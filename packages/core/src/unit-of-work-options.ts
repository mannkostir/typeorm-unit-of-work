import type { DataSource, QueryRunner } from 'typeorm';
import { DataSourceNotInitializedError, InvalidUnitOfWorkOptionsError } from './errors/unit-of-work-errors';
import type { AfterCommitErrorHandler, DomainEventPublisher } from './events/domain-event-publisher';

export type IsolationLevel = NonNullable<Parameters<QueryRunner['startTransaction']>[0]>;

export type Propagation = 'join' | 'new' | 'nested';

export interface UnitOfWorkOptions {
  readonly dataSource: DataSource;
  readonly publisher: DomainEventPublisher;
  readonly onAfterCommitError: AfterCommitErrorHandler;
  readonly maxEventRounds?: number;
  readonly strict?: boolean;
}

export interface RunOptions<Result> {
  readonly propagation?: Propagation;
  readonly isolationLevel?: IsolationLevel;
  readonly commitWhen?: (result: Result) => boolean;
}

export interface ResolvedUnitOfWorkOptions {
  readonly dataSource: DataSource;
  readonly publisher: DomainEventPublisher;
  readonly onAfterCommitError: AfterCommitErrorHandler;
  readonly maxEventRounds: number;
  readonly strict: boolean;
}

export interface ResolvedRunOptions<Result> {
  readonly propagation: Propagation;
  readonly isolationLevel: IsolationLevel | undefined;
  readonly commitWhen: (result: Result) => boolean;
}

const propagations: readonly Propagation[] = ['join', 'new', 'nested'];

const defaultMaxEventRounds = 100;

export function resolveUnitOfWorkOptions(options: UnitOfWorkOptions): ResolvedUnitOfWorkOptions {
  if (!isDataSource(options.dataSource)) {
    throw new InvalidUnitOfWorkOptionsError('dataSource', 'must be a TypeORM DataSource');
  }
  if (!options.dataSource.isInitialized) {
    throw new DataSourceNotInitializedError();
  }
  if (typeof options.onAfterCommitError !== 'function') {
    throw new InvalidUnitOfWorkOptionsError('onAfterCommitError', 'must be a function that receives (error, event)');
  }
  if (!isDomainEventPublisher(options.publisher)) {
    throw new InvalidUnitOfWorkOptionsError(
      'publisher',
      'must implement beforeCommit(events, context) and afterCommit(events, reportError)',
    );
  }
  const maxEventRounds = options.maxEventRounds ?? defaultMaxEventRounds;
  if (!Number.isInteger(maxEventRounds) || maxEventRounds < 1) {
    throw new InvalidUnitOfWorkOptionsError('maxEventRounds', 'must be an integer of at least 1');
  }
  return {
    dataSource: options.dataSource,
    publisher: options.publisher,
    onAfterCommitError: options.onAfterCommitError,
    maxEventRounds,
    strict: options.strict ?? false,
  };
}

export function resolveRunOptions<Result>(options: RunOptions<Result> = {}): ResolvedRunOptions<Result> {
  const propagation = options.propagation ?? 'join';
  if (!propagations.includes(propagation)) {
    throw new InvalidUnitOfWorkOptionsError('propagation', `must be one of ${propagations.join(', ')}`);
  }
  return {
    propagation,
    isolationLevel: options.isolationLevel,
    commitWhen: options.commitWhen ?? commitEveryResult,
  };
}

function commitEveryResult(): boolean {
  return true;
}

function isDataSource(value: unknown): value is DataSource {
  return (
    typeof value === 'object' && value !== null && 'isInitialized' in value && typeof value.isInitialized === 'boolean'
  );
}

function isDomainEventPublisher(value: unknown): value is DomainEventPublisher {
  return (
    typeof value === 'object' &&
    value !== null &&
    'beforeCommit' in value &&
    typeof value.beforeCommit === 'function' &&
    'afterCommit' in value &&
    typeof value.afterCommit === 'function'
  );
}
