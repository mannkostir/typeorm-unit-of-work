import { DataSource } from 'typeorm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { DataSourceNotInitializedError, InvalidUnitOfWorkOptionsError } from '../../src/errors/unit-of-work-errors';
import type { DomainEventPublisher } from '../../src/events/domain-event-publisher';
import {
  resolveRunOptions,
  resolveUnitOfWorkOptions,
  type UnitOfWorkOptions,
} from '../../src/unit-of-work-options';
import { unusedDataSource } from './support/unused-context';

const publisher: DomainEventPublisher = {
  beforeCommit: async () => undefined,
  afterCommit: async () => undefined,
};

const ignoreAfterCommitError = (): void => undefined;

describe('resolveUnitOfWorkOptions', () => {
  const dataSource = new DataSource({ type: 'better-sqlite3', database: ':memory:' });
  let valid: UnitOfWorkOptions;

  beforeAll(async () => {
    await dataSource.initialize();
    valid = { dataSource, publisher, onAfterCommitError: ignoreAfterCommitError };
  });

  afterAll(async () => {
    await dataSource.destroy();
  });

  it.each([
    ['missing', undefined],
    ['without isInitialized', {}],
  ])('rejects a dataSource that is %s', (_, dataSource) => {
    const options = { ...valid, dataSource } as unknown as UnitOfWorkOptions;

    expect(() => resolveUnitOfWorkOptions(options)).toThrow(
      new InvalidUnitOfWorkOptionsError('dataSource', 'must be a TypeORM DataSource'),
    );
  });

  it('rejects a DataSource that is not initialized', () => {
    expect(() => resolveUnitOfWorkOptions({ ...valid, dataSource: unusedDataSource })).toThrow(
      DataSourceNotInitializedError,
    );
  });

  it('rejects a missing after-commit error handler', () => {
    const options = { ...valid, onAfterCommitError: undefined } as unknown as UnitOfWorkOptions;

    expect(() => resolveUnitOfWorkOptions(options)).toThrow(
      new InvalidUnitOfWorkOptionsError('onAfterCommitError', 'must be a function that receives (error, event)'),
    );
  });

  it('rejects a publisher without afterCommit', () => {
    const options = { ...valid, publisher: { beforeCommit: publisher.beforeCommit } } as unknown as UnitOfWorkOptions;

    expect(() => resolveUnitOfWorkOptions(options)).toThrow(InvalidUnitOfWorkOptionsError);
  });

  it.each([0, 1.5, -1])('rejects maxEventRounds %s', (maxEventRounds) => {
    expect(() => resolveUnitOfWorkOptions({ ...valid, maxEventRounds })).toThrow(
      new InvalidUnitOfWorkOptionsError('maxEventRounds', 'must be an integer of at least 1'),
    );
  });

  it('defaults to 100 event rounds and lenient scope access', () => {
    expect(resolveUnitOfWorkOptions(valid)).toMatchObject({ maxEventRounds: 100, strict: false });
  });
});

describe('resolveRunOptions', () => {
  it('joins the current transaction by default', () => {
    expect(resolveRunOptions(undefined).propagation).toBe('join');
  });

  it('leaves the isolation level to the driver by default', () => {
    expect(resolveRunOptions(undefined).isolationLevel).toBeUndefined();
  });

  it('commits every result by default', () => {
    expect(resolveRunOptions<string>(undefined).commitWhen('anything')).toBe(true);
  });

  it('rejects an unknown propagation', () => {
    expect(() => resolveRunOptions({ propagation: 'required' as never })).toThrow(
      new InvalidUnitOfWorkOptionsError('propagation', 'must be one of join, new, nested'),
    );
  });
});
