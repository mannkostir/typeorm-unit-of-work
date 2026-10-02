import { copyFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const repositoryRoot = fileURLToPath(new URL('..', import.meta.url));

for (const document of ['README.md', 'LICENSE']) {
  await copyFile(`${repositoryRoot}${document}`, document);
}
