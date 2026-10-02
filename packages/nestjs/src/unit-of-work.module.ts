import { type DynamicModule, type FactoryProvider, Module, type ModuleMetadata } from '@nestjs/common';
import { DiscoveryModule, DiscoveryService, MetadataScanner, Reflector } from '@nestjs/core';
import { UnitOfWork, type UnitOfWorkOptions } from 'typeorm-unit-of-work';
import { TransactionalMethodsBinder } from './transactional-methods-binder';

export interface UnitOfWorkModuleAsyncOptions {
  readonly imports?: ModuleMetadata['imports'];
  readonly inject?: FactoryProvider['inject'];
  readonly useFactory: (...dependencies: never[]) => UnitOfWorkOptions | Promise<UnitOfWorkOptions>;
}

@Module({})
export class UnitOfWorkModule {
  static forRootAsync(options: UnitOfWorkModuleAsyncOptions): DynamicModule {
    return {
      module: UnitOfWorkModule,
      global: true,
      imports: [DiscoveryModule, ...(options.imports ?? [])],
      providers: [
        {
          provide: UnitOfWork,
          inject: options.inject ?? [],
          useFactory: async (...dependencies: never[]) => new UnitOfWork(await options.useFactory(...dependencies)),
        },
        {
          provide: TransactionalMethodsBinder,
          inject: [DiscoveryService, MetadataScanner, Reflector, UnitOfWork],
          useFactory: (
            discovery: DiscoveryService,
            scanner: MetadataScanner,
            reflector: Reflector,
            uow: UnitOfWork,
          ) => new TransactionalMethodsBinder(discovery, scanner, reflector, uow),
        },
      ],
      exports: [UnitOfWork],
    };
  }
}
