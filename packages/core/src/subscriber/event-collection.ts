import type { DataSource } from 'typeorm';
import { ScopeRegistry } from '../scope/scope-registry';
import { EventCollectingSubscriber } from './event-collecting-subscriber';

const registriesByDataSource = new WeakMap<DataSource, ScopeRegistry>();

export function eventCollectionFor(dataSource: DataSource): ScopeRegistry {
  const existing = registriesByDataSource.get(dataSource);
  if (existing !== undefined) {
    return existing;
  }
  const registry = new ScopeRegistry();
  dataSource.subscribers.push(new EventCollectingSubscriber(registry));
  registriesByDataSource.set(dataSource, registry);
  return registry;
}
