import { DataSource, type DataSourceOptions } from 'typeorm';
import { inject } from 'vitest';
import { auditEntrySchema, orderSchema } from './model';

export interface TestDatabase {
  readonly name: string;
  open(): Promise<DataSource>;
}

const entities = [orderSchema, auditEntrySchema];

export const postgres: TestDatabase = {
  name: 'postgres',
  open: () =>
    initialize({ type: 'postgres', url: inject('postgresUrl'), entities, synchronize: true, dropSchema: true }),
};

export const sqlite: TestDatabase = {
  name: 'sqlite',
  open: () => initialize({ type: 'better-sqlite3', database: ':memory:', entities, synchronize: true }),
};

export const databases: readonly TestDatabase[] = [postgres, sqlite];

function initialize(options: DataSourceOptions): Promise<DataSource> {
  return new DataSource(options).initialize();
}
