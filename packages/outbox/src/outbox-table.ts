import { InvalidOutboxOptionsError } from './errors/outbox-errors';

const identifierPath = /^[A-Za-z_][A-Za-z0-9_]*(\.[A-Za-z_][A-Za-z0-9_]*)?$/;

export class OutboxTable {
  private constructor(readonly quotedName: string) {}

  static named(name: unknown): OutboxTable {
    if (typeof name !== 'string' || !identifierPath.test(name)) {
      throw new InvalidOutboxOptionsError(
        'table',
        'must be an identifier or schema.identifier of letters, digits and underscores, not starting with a digit',
      );
    }
    return new OutboxTable(
      name
        .split('.')
        .map((part) => `"${part}"`)
        .join('.'),
    );
  }
}
