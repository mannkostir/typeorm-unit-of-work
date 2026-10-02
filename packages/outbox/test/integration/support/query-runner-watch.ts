import type { DataSource } from 'typeorm';
import { vi } from 'vitest';

export interface QueryRunnerWatch {
  unreleasedCount(): number;
}

export function watchQueryRunners(dataSource: DataSource): QueryRunnerWatch {
  const counts = { created: 0, released: 0 };
  const wrapped = new WeakSet<object>();
  const createQueryRunner = dataSource.createQueryRunner.bind(dataSource);
  vi.spyOn(dataSource, 'createQueryRunner').mockImplementation((mode) => {
    const queryRunner = createQueryRunner(mode);
    counts.created += 1;
    if (!wrapped.has(queryRunner)) {
      wrapped.add(queryRunner);
      const release = queryRunner.release.bind(queryRunner);
      queryRunner.release = async () => {
        counts.released += 1;
        await release();
      };
    }
    return queryRunner;
  });
  return { unreleasedCount: () => counts.created - counts.released };
}
