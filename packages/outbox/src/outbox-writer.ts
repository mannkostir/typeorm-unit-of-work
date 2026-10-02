import type { EntityManager } from 'typeorm';
import { assertPostgres } from './driver-type';
import type { OutboxRow } from './outbox-row';
import { insertStatements, type SqlStatement } from './outbox-statements';
import type { OutboxTable } from './outbox-table';

export class OutboxWriter {
  readonly #table: OutboxTable;

  constructor(table: OutboxTable) {
    this.#table = table;
  }

  async write(manager: EntityManager, rows: readonly OutboxRow[]): Promise<void> {
    assertPostgres(manager);
    for (const statement of insertStatements(this.#table, rows)) {
      await execute(manager, statement);
    }
  }
}

async function execute(manager: EntityManager, statement: SqlStatement): Promise<void> {
  await manager.query(statement.sql, [...statement.parameters]);
}
