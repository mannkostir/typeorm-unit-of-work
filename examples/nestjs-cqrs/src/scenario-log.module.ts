import { Global, Module } from '@nestjs/common';
import { ScenarioLog } from './scenario-log.js';

@Global()
@Module({
  providers: [{ provide: ScenarioLog, useFactory: () => new ScenarioLog() }],
  exports: [ScenarioLog],
})
export class ScenarioLogModule {}
