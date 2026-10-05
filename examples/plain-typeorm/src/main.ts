import 'reflect-metadata';
import { createDataSource } from './data-source.js';
import { runScenario } from './scenario.js';

const dataSource = await createDataSource().initialize();
try {
  for (const line of await runScenario(dataSource)) {
    console.log(line);
  }
} finally {
  await dataSource.destroy();
}
