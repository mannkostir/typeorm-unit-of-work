import type { DataSource } from 'typeorm';

export interface WalSlot {
  committedOutboxInserts(): Promise<string[]>;
  drop(): Promise<void>;
}

const slotName = 'outbox_wal_contract';

export async function openWalSlot(dataSource: DataSource): Promise<WalSlot> {
  await dataSource.query(`SELECT pg_create_logical_replication_slot($1, 'test_decoding')`, [slotName]);
  return {
    committedOutboxInserts: async () => {
      const changes: { data: string }[] = await dataSource.query(
        'SELECT data FROM pg_logical_slot_get_changes($1, NULL, NULL)',
        [slotName],
      );
      return changes.map((change) => change.data).filter((data) => data.startsWith('table public.outbox: INSERT:'));
    },
    drop: async () => {
      await dataSource.query('SELECT pg_drop_replication_slot($1)', [slotName]);
    },
  };
}
