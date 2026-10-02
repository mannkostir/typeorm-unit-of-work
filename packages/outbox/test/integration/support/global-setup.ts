import { PostgreSqlContainer } from '@testcontainers/postgresql';
import type { TestProject } from 'vitest/node';

declare module 'vitest' {
  export interface ProvidedContext {
    postgresUrl: string;
  }
}

export default async function setup(project: TestProject): Promise<() => Promise<void>> {
  const container = await new PostgreSqlContainer('postgres:17-alpine')
    .withCommand(['postgres', '-c', 'wal_level=logical'])
    .start();
  project.provide('postgresUrl', container.getConnectionUri());
  return async () => {
    await container.stop();
  };
}
