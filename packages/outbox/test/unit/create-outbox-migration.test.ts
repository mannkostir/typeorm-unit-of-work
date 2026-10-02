import { describe, expect, it } from 'vitest';
import { createOutboxMigration } from '../../src/create-outbox-migration';
import { InvalidOutboxOptionsError } from '../../src/errors/outbox-errors';

describe('createOutboxMigration', () => {
  it('names the migration after its timestamp so TypeORM can order it', () => {
    const Migration = createOutboxMigration({ timestamp: 1759363200000 });

    expect(new Migration().name).toBe('CreateOutbox1759363200000');
  });

  it.each([[175936320000], [17593632000000], [1759363200000.5], [Number.NaN]])('rejects the timestamp %s', (timestamp) => {
    expect(() => createOutboxMigration({ timestamp })).toThrow(
      new InvalidOutboxOptionsError(
        'timestamp',
        'must be a 13-digit JavaScript timestamp, such as Date.now() when the migration was written',
      ),
    );
  });

  it('rejects an invalid table name', () => {
    expect(() => createOutboxMigration({ timestamp: 1759363200000, table: 'out box' })).toThrow(
      InvalidOutboxOptionsError,
    );
  });
});
