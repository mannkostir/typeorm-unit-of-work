import { describe, expect, it } from 'vitest';
import type { OutboxRow } from '../../src/outbox-row';
import { deleteStatement, insertStatements } from '../../src/outbox-statements';
import { OutboxTable } from '../../src/outbox-table';

const table = OutboxTable.named('outbox');

const row = (index: number): OutboxRow => ({
  id: `id-${index}`,
  type: 'order.shipped',
  aggregateType: 'order',
  aggregateId: `o-${index}`,
  payload: '{}',
});

const rows = (count: number): OutboxRow[] => Array.from({ length: count }, (_, index) => row(index));

describe('insertStatements', () => {
  it('inserts one row with its five parameters', () => {
    expect(insertStatements(table, [row(1)])).toEqual([
      {
        sql: 'INSERT INTO "outbox" ("id", "aggregatetype", "aggregateid", "type", "payload") VALUES ($1, $2, $3, $4, $5::jsonb)',
        parameters: ['id-1', 'order', 'o-1', 'order.shipped', '{}'],
      },
    ]);
  });

  it('numbers the parameters of each following row on from the previous one', () => {
    const [statement] = insertStatements(table, rows(2));

    expect(statement?.sql).toContain('VALUES ($1, $2, $3, $4, $5::jsonb), ($6, $7, $8, $9, $10::jsonb)');
  });

  it('keeps 1,000 rows in one statement', () => {
    expect(insertStatements(table, rows(1000))).toHaveLength(1);
  });

  it('starts a new statement at row 1,001 with its own numbering', () => {
    const [, second] = insertStatements(table, rows(1001));

    expect(second).toEqual({
      sql: 'INSERT INTO "outbox" ("id", "aggregatetype", "aggregateid", "type", "payload") VALUES ($1, $2, $3, $4, $5::jsonb)',
      parameters: ['id-1000', 'order', 'o-1000', 'order.shipped', '{}'],
    });
  });

  it('writes to a schema-qualified table', () => {
    const [statement] = insertStatements(OutboxTable.named('app.outbox'), [row(1)]);

    expect(statement?.sql).toMatch(/^INSERT INTO "app"\."outbox" /);
  });

  it('builds no statement for no rows', () => {
    expect(insertStatements(table, [])).toEqual([]);
  });
});

describe('deleteStatement', () => {
  it('deletes the given ids as one array parameter', () => {
    expect(deleteStatement(table, ['id-1', 'id-2'])).toEqual({
      sql: 'DELETE FROM "outbox" WHERE "id" = ANY($1::uuid[])',
      parameters: [['id-1', 'id-2']],
    });
  });
});
