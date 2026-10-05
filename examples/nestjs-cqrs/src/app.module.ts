import { Module } from '@nestjs/common';
import { CqrsModule, EventBus } from '@nestjs/cqrs';
import { DataSource } from 'typeorm';
import { CqrsEventBusPublisher, UnitOfWorkModule } from 'typeorm-unit-of-work-nestjs';
import { DatabaseModule } from './database.module.js';
import { createHistoryRecordingPublisher } from './history-recording-publisher.js';
import { OrderShippedHandler } from './order-shipped.handler.js';
import { ScenarioLog } from './scenario-log.js';
import { ScenarioLogModule } from './scenario-log.module.js';
import { ShippingNotifier } from './shipping-notifier.js';
import { ShippingService } from './shipping.service.js';

@Module({
  imports: [
    ScenarioLogModule,
    DatabaseModule,
    CqrsModule.forRoot(),
    UnitOfWorkModule.forRootAsync({
      imports: [CqrsModule],
      inject: [DataSource, EventBus, ScenarioLog],
      useFactory: (dataSource: DataSource, eventBus: EventBus, log: ScenarioLog) => ({
        dataSource,
        publisher: new CqrsEventBusPublisher(eventBus, createHistoryRecordingPublisher(log)),
        onAfterCommitError: (error: unknown) => log.record(`after-commit handler failed: ${String(error)}`),
      }),
    }),
  ],
  providers: [ShippingService, ShippingNotifier, OrderShippedHandler],
})
export class AppModule {}
