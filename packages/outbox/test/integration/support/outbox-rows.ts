import type { DataSource } from 'typeorm';

export interface StoredOutboxRow {
  readonly id: string;
  readonly aggregatetype: string;
  readonly aggregateid: string;
  readonly type: string;
  readonly payload: unknown;
}

export const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

export function storedOutboxRows(dataSource: DataSource, quotedTable = '"outbox"'): Promise<StoredOutboxRow[]> {
  return dataSource.query(
    `SELECT "id", "aggregatetype", "aggregateid", "type", "payload" FROM ${quotedTable} ORDER BY "aggregateid", "type"`,
  );
}
