import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module.js';
import { runScenario } from './scenario.js';

const app = await NestFactory.createApplicationContext(AppModule, { logger: false });
try {
  for (const line of await runScenario(app)) {
    console.log(line);
  }
} finally {
  await app.close();
}
