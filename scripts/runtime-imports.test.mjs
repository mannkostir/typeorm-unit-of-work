import assert from 'node:assert/strict';
import { test } from 'node:test';
import { importsModuleAtRuntime } from './runtime-imports.mjs';

const detected = [
  `import { DataSource } from 'typeorm';`,
  `import { DataSource } from "typeorm";`,
  `const { DataSource } = require('typeorm');`,
  `import 'typeorm';`,
  `const typeorm = await import('typeorm');`,
  `import { x } from 'typeorm/driver/x';`,
  `const x = require("typeorm/x");`,
  `const x = await import('typeorm/x');`,
  `export { DataSource } from 'typeorm';`,
];

const ignored = [
  `import { UnitOfWork } from 'typeorm-unit-of-work';`,
  `import { x } from 'typeorm-extra';`,
  `import { x } from 'my-typeorm';`,
  `import { x } from '@scope/typeorm';`,
  `const x = require('typeorm-extra');`,
  `import 'typeorm-extra';`,
  `const x = await import('@scope/typeorm');`,
  `const typeorm = 'typeorm';`,
];

for (const source of detected) {
  test(`detects runtime import in ${source}`, () => {
    assert.equal(importsModuleAtRuntime(source, 'typeorm'), true);
  });
}

for (const source of ignored) {
  test(`ignores ${source}`, () => {
    assert.equal(importsModuleAtRuntime(source, 'typeorm'), false);
  });
}

test('treats dots in the module name literally', () => {
  assert.equal(importsModuleAtRuntime(`import 'axbyc';`, 'a.b'), false);
});

test('treats plus in the module name literally', () => {
  assert.equal(importsModuleAtRuntime(`import 'a+b';`, 'a+b'), true);
});

test('detects hyphenated module names', () => {
  assert.equal(importsModuleAtRuntime(`require('typeorm-unit-of-work')`, 'typeorm-unit-of-work'), true);
});
