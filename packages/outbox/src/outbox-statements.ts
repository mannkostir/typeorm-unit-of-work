import type { OutboxRow } from './outbox-row';
import type { OutboxTable } from './outbox-table';

export interface SqlStatement {
  readonly sql: string;
  readonly parameters: readonly unknown[];
}

export const maxRowsPerInsert = 1000;

const columnsPerRow = 5;

export function insertStatements(table: OutboxTable, rows: readonly OutboxRow[]): SqlStatement[] {
  return chunked(rows, maxRowsPerInsert).map((chunk) => insertStatement(table, chunk));
}

export function deleteStatement(table: OutboxTable, ids: readonly string[]): SqlStatement {
  return { sql: `DELETE FROM ${table.quotedName} WHERE "id" = ANY($1::uuid[])`, parameters: [ids] };
}

function insertStatement(table: OutboxTable, rows: readonly OutboxRow[]): SqlStatement {
  const values = rows.map((_, index) => valuesPlaceholder(index * columnsPerRow)).join(', ');
  return {
    sql: `INSERT INTO ${table.quotedName} ("id", "aggregatetype", "aggregateid", "type", "payload") VALUES ${values}`,
    parameters: rows.flatMap((row) => [row.id, row.aggregateType, row.aggregateId, row.type, row.payload]),
  };
}

function valuesPlaceholder(offset: number): string {
  return `($${offset + 1}, $${offset + 2}, $${offset + 3}, $${offset + 4}, $${offset + 5}::jsonb)`;
}

function chunked<Item>(items: readonly Item[], size: number): Item[][] {
  const chunks: Item[][] = [];
  for (let start = 0; start < items.length; start += size) {
    chunks.push(items.slice(start, start + size));
  }
  return chunks;
}
