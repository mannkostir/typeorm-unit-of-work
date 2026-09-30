import type { OnModuleInit } from '@nestjs/common';
import type { DiscoveryService, MetadataScanner, Reflector } from '@nestjs/core';
import type { RunOptions, UnitOfWork } from 'typeorm-unit-of-work';
import { TRANSACTIONAL_OPTIONS } from './transactional.decorator';
import { TransactionalBindingError } from './transactional-binding-error';

type DiscoveredWrapper = ReturnType<DiscoveryService['getProviders']>[number];

type Method = (...args: unknown[]) => unknown;

interface DecoratedMethod {
  readonly name: string;
  readonly options: RunOptions<unknown>;
}

export class TransactionalMethodsBinder implements OnModuleInit {
  readonly #boundInstances = new Set<object>();

  constructor(
    private readonly discovery: DiscoveryService,
    private readonly scanner: MetadataScanner,
    private readonly reflector: Reflector,
    private readonly uow: UnitOfWork,
  ) {}

  onModuleInit(): void {
    for (const wrapper of this.discovery.getControllers()) {
      this.#rejectDecoratedMethods(wrapper, 'controllers are not supported; move the transaction into a provider');
    }
    for (const wrapper of this.discovery.getProviders()) {
      this.#bindProvider(wrapper);
    }
  }

  #bindProvider(wrapper: DiscoveredWrapper): void {
    if (!wrapper.isDependencyTreeStatic()) {
      this.#rejectDecoratedMethods(wrapper, 'the provider is request-scoped or transient; make it a singleton');
      return;
    }
    const instance: unknown = wrapper.instance;
    if (typeof instance !== 'object' || instance === null || this.#boundInstances.has(instance)) {
      return;
    }
    this.#boundInstances.add(instance);
    for (const method of this.#decoratedMethods(Object.getPrototypeOf(instance))) {
      this.#wrap(instance as Record<string, Method>, method);
    }
  }

  #rejectDecoratedMethods(wrapper: DiscoveredWrapper, reason: string): void {
    const [first] = this.#decoratedMethods(wrapper.metatype?.prototype);
    if (first !== undefined) {
      throw new TransactionalBindingError(wrapper.metatype?.name ?? String(wrapper.token), first.name, reason);
    }
  }

  #decoratedMethods(prototype: unknown): readonly DecoratedMethod[] {
    if (typeof prototype !== 'object' || prototype === null) {
      return [];
    }
    return this.scanner.getAllMethodNames(prototype).flatMap((name) => {
      const options = this.reflector.get<RunOptions<unknown> | undefined>(
        TRANSACTIONAL_OPTIONS,
        (prototype as Record<string, Method>)[name] as Method,
      );
      return options === undefined ? [] : [{ name, options }];
    });
  }

  #wrap(instance: Record<string, Method>, method: DecoratedMethod): void {
    const original = instance[method.name] as Method;
    const uow = this.uow;
    instance[method.name] = function transactional(this: unknown, ...args: unknown[]) {
      return uow.run(async () => original.apply(this, args), method.options);
    };
  }
}
