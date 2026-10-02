import type { EntityManager } from 'typeorm';
import { assertPostgres } from './driver-type';
import type { OutboxRowRetention } from './outbox-options';
import type { OutboxRow } from './outbox-row';
import { deleteStatement, insertStatements, type SqlStatement } from './outbox-statements';
import type { OutboxTable } from './outbox-table';

export class OutboxWriter {
  readonly #table: OutboxTable;
  readonly #retention: OutboxRowRetention;

  constructor(table: OutboxTable, retention: OutboxRowRetention) {
    this.#table = table;
    this.#retention = retention;
  }

  async write(manager: EntityManager, rows: readonly OutboxRow[]): Promise<void> {
    assertPostgres(manager);
    for (const statement of insertStatements(this.#table, rows)) {
      await execute(manager, statement);
    }
    if (this.#retention === 'delete') {
      await execute(manager, deleteStatement(this.#table, rows.map((row) => row.id)));
    }
  }
}

async function execute(manager: EntityManager, statement: SqlStatement): Promise<void> {
  await manager.query(statement.sql, [...statement.parameters]);
}
