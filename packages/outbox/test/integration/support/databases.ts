import { DataSource } from 'typeorm';
import { inject } from 'vitest';
import { createOutboxMigration } from '../../../src/create-outbox-migration';
import { orderSchema } from './model';

export const outboxMigrationTimestamp = 1759363200000;

export async function openPostgres(table = 'outbox'): Promise<DataSource> {
  const dataSource = await new DataSource({
    type: 'postgres',
    url: inject('postgresUrl'),
    entities: [orderSchema],
    synchronize: true,
    dropSchema: true,
    migrations: [createOutboxMigration({ timestamp: outboxMigrationTimestamp, table })],
  }).initialize();
  await dataSource.query('DROP SCHEMA IF EXISTS "app" CASCADE');
  await dataSource.query('CREATE SCHEMA "app"');
  await dataSource.runMigrations();
  return dataSource;
}

export function openSqlite(): Promise<DataSource> {
  return new DataSource({
    type: 'better-sqlite3',
    database: ':memory:',
    entities: [orderSchema],
    synchronize: true,
  }).initialize();
}
