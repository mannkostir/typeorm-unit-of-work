import type { EntityManager, QueryRunner } from 'typeorm';
import { UnsupportedDriverError } from './errors/outbox-errors';

export function assertPostgres(executor: EntityManager | QueryRunner): void {
  const driverType = executor.connection.options.type;
  if (driverType !== 'postgres') {
    throw new UnsupportedDriverError(driverType);
  }
}
