import { copyFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const repositoryRoot = fileURLToPath(new URL('..', import.meta.url));

await copyFile(`${repositoryRoot}LICENSE`, 'LICENSE');
