import { SetMetadata } from '@nestjs/common';
import type { RunOptions } from 'typeorm-unit-of-work';

export const TRANSACTIONAL_OPTIONS = Symbol('typeorm-unit-of-work-nestjs:transactional-options');

type AsyncMethod = (...args: never[]) => Promise<unknown>;

export type AsyncMethodDecorator = <Method extends AsyncMethod>(
  target: object,
  propertyKey: string | symbol,
  descriptor: TypedPropertyDescriptor<Method>,
) => void;

export function Transactional(options: RunOptions<unknown> = {}): AsyncMethodDecorator {
  const recordOptions = SetMetadata(TRANSACTIONAL_OPTIONS, options);
  return (target, propertyKey, descriptor) => {
    recordOptions(target, propertyKey, descriptor);
  };
}
