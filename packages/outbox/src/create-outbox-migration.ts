import type { MigrationInterface, QueryRunner } from 'typeorm';
import { assertPostgres } from './driver-type';
import { InvalidOutboxOptionsError } from './errors/outbox-errors';
import { createTableSql, dropTableSql } from './outbox-ddl';
import { OutboxTable } from './outbox-table';

export interface OutboxMigrationOptions {
  readonly timestamp: number;
  readonly table?: string;
}

const smallestTimestamp = 1_000_000_000_000;
const largestTimestamp = 9_999_999_999_999;

export function createOutboxMigration(options: OutboxMigrationOptions): new () => MigrationInterface {
  const timestamp = thirteenDigitTimestamp(options.timestamp);
  const table = OutboxTable.named(options.table ?? 'outbox');
  return class CreateOutboxMigration implements MigrationInterface {
    readonly name = `CreateOutbox${timestamp}`;

    async up(queryRunner: QueryRunner): Promise<void> {
      assertPostgres(queryRunner);
      await queryRunner.query(createTableSql(table));
    }

    async down(queryRunner: QueryRunner): Promise<void> {
      assertPostgres(queryRunner);
      await queryRunner.query(dropTableSql(table));
    }
  };
}

function thirteenDigitTimestamp(timestamp: unknown): number {
  if (
    typeof timestamp !== 'number' ||
    !Number.isInteger(timestamp) ||
    timestamp < smallestTimestamp ||
    timestamp > largestTimestamp
  ) {
    throw new InvalidOutboxOptionsError(
      'timestamp',
      'must be a 13-digit JavaScript timestamp, such as Date.now() when the migration was written',
    );
  }
  return timestamp;
}
