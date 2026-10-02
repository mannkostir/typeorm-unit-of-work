import { DataSource } from 'typeorm';
import { afterEach, describe, expect, it } from 'vitest';
import { createOutboxMigration } from '../../src/create-outbox-migration';
import { UnsupportedDriverError } from '../../src/errors/outbox-errors';
import { openPostgres, outboxMigrationTimestamp } from './support/databases';

describe('outbox migration', () => {
  let dataSource: DataSource;

  afterEach(async () => {
    await dataSource.destroy();
  });

  it('creates the Debezium outbox columns', async () => {
    dataSource = await openPostgres();

    const columns: unknown[] = await dataSource.query(
      `SELECT column_name, data_type, character_maximum_length, is_nullable FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'outbox' ORDER BY ordinal_position`,
    );

    expect(columns).toEqual([
      { column_name: 'id', data_type: 'uuid', character_maximum_length: null, is_nullable: 'NO' },
      { column_name: 'aggregatetype', data_type: 'character varying', character_maximum_length: 255, is_nullable: 'NO' },
      { column_name: 'aggregateid', data_type: 'character varying', character_maximum_length: 255, is_nullable: 'NO' },
      { column_name: 'type', data_type: 'character varying', character_maximum_length: 255, is_nullable: 'NO' },
      { column_name: 'payload', data_type: 'jsonb', character_maximum_length: null, is_nullable: 'YES' },
    ]);
  });

  it('makes the id the primary key', async () => {
    dataSource = await openPostgres();

    const keys: unknown[] = await dataSource.query(
      `SELECT a.attname AS column_name FROM pg_index i JOIN pg_attribute a ON a.attrelid = i.indrelid AND a.attnum = ANY(i.indkey) WHERE i.indrelid = 'public.outbox'::regclass AND i.indisprimary`,
    );

    expect(keys).toEqual([{ column_name: 'id' }]);
  });

  it('drops the table when reverted', async () => {
    dataSource = await openPostgres();

    await dataSource.undoLastMigration();

    expect(await dataSource.query(`SELECT to_regclass('public.outbox') AS name`)).toEqual([{ name: null }]);
  });

  it('creates a schema-qualified table in its schema', async () => {
    dataSource = await openPostgres('app.outbox');

    expect(await dataSource.query(`SELECT to_regclass('app.outbox')::text AS name`)).toEqual([{ name: 'app.outbox' }]);
  });

  it('refuses to run on SQLite', async () => {
    dataSource = await new DataSource({
      type: 'better-sqlite3',
      database: ':memory:',
      migrations: [createOutboxMigration({ timestamp: outboxMigrationTimestamp })],
    }).initialize();

    await expect(dataSource.runMigrations()).rejects.toBeInstanceOf(UnsupportedDriverError);
  });
});
