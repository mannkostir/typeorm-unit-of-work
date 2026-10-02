import { describe, expectTypeOf, it } from 'vitest';
import { Transactional } from '../src/transactional.decorator';

type Decorates<Method> =
  ReturnType<typeof Transactional> extends (
    target: object,
    propertyKey: string | symbol,
    descriptor: TypedPropertyDescriptor<Method>,
  ) => unknown
    ? true
    : false;

describe('@Transactional()', () => {
  it('decorates a method that returns a promise', () => {
    expectTypeOf<Decorates<(id: string) => Promise<void>>>().toEqualTypeOf<true>();
  });

  it('refuses a method that does not return a promise', () => {
    expectTypeOf<Decorates<(id: string) => string>>().toEqualTypeOf<false>();
  });
});
