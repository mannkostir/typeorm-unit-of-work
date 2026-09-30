import { SetMetadata } from '@nestjs/common';
import type { RunOptions } from 'typeorm-unit-of-work';

export const TRANSACTIONAL_OPTIONS = Symbol('typeorm-unit-of-work-nestjs:transactional-options');

export function Transactional(options: RunOptions<unknown> = {}): MethodDecorator {
  return SetMetadata(TRANSACTIONAL_OPTIONS, options);
}
