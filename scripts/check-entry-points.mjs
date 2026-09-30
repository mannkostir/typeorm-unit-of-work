import { readdir, readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { join } from 'node:path';

const require = createRequire(import.meta.url);

const packages = [
  { name: 'typeorm-unit-of-work', exportName: 'UnitOfWork', distDirectory: 'packages/core/dist', forbiddenImport: 'typeorm' },
];

for (const { name, exportName, distDirectory, forbiddenImport } of packages) {
  const imported = await import(name);
  const required = require(name);
  if (typeof imported[exportName] !== 'function' || typeof required[exportName] !== 'function') {
    throw new Error(`${name} does not expose ${exportName} through both import and require`);
  }
  if (forbiddenImport !== undefined) {
    await assertNoRuntimeImport(distDirectory, forbiddenImport);
  }
  console.log(`${name}: import and require both load ${exportName}`);
}

async function assertNoRuntimeImport(directory, moduleName) {
  const files = (await readdir(directory)).filter((file) => /\.(c?js)$/.test(file));
  const pattern = new RegExp(`(from\\s*|require\\()\\s*['"]${moduleName}['"]`);
  for (const file of files) {
    const source = await readFile(join(directory, file), 'utf8');
    if (pattern.test(source)) {
      throw new Error(`${directory}/${file} imports ${moduleName} at runtime`);
    }
  }
}
