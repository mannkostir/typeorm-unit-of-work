import { Global, Inject, Module, type OnApplicationShutdown } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { createDataSource } from './data-source.js';

@Global()
@Module({
  providers: [{ provide: DataSource, useFactory: () => createDataSource().initialize() }],
  exports: [DataSource],
})
export class DatabaseModule implements OnApplicationShutdown {
  constructor(@Inject(DataSource) private readonly dataSource: DataSource) {}

  async onApplicationShutdown(): Promise<void> {
    await this.dataSource.destroy();
  }
}
