import { maxColumnCharacters } from './column-value';
import type { OutboxTable } from './outbox-table';

const text = `varchar(${maxColumnCharacters})`;

export function createTableSql(table: OutboxTable): string {
  return `CREATE TABLE ${table.quotedName} ("id" uuid PRIMARY KEY, "aggregatetype" ${text} NOT NULL, "aggregateid" ${text} NOT NULL, "type" ${text} NOT NULL, "payload" jsonb)`;
}

export function dropTableSql(table: OutboxTable): string {
  return `DROP TABLE ${table.quotedName}`;
}
