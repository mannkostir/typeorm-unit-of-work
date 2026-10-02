import { describe, expect, it } from 'vitest';
import { InvalidOutboxOptionsError } from '../../src/errors/outbox-errors';
import { OutboxTable } from '../../src/outbox-table';

describe('OutboxTable', () => {
  it('quotes a plain table name', () => {
    expect(OutboxTable.named('outbox').quotedName).toBe('"outbox"');
  });

  it('quotes each part of a schema-qualified name', () => {
    expect(OutboxTable.named('app.outbox').quotedName).toBe('"app"."outbox"');
  });

  it('keeps the case of the name', () => {
    expect(OutboxTable.named('Outbox_2').quotedName).toBe('"Outbox_2"');
  });

  it.each([['outbox; DROP TABLE orders'], ['1outbox'], ['a.b.c'], ['out"box'], [''], [42]])(
    'rejects %j',
    (name) => {
      expect(() => OutboxTable.named(name)).toThrow(InvalidOutboxOptionsError);
    },
  );
});
