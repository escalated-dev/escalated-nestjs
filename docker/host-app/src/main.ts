import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import cookieParser = require('cookie-parser');
import { AppModule } from './app.module';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  app.use(cookieParser());
  app.enableCors();
  const port = parseInt(process.env.APP_PORT || '8000', 10);
  await app.listen(port, '0.0.0.0');
  console.log(`[demo] NestJS listening on :${port}`);
  console.log(`[demo] landing: http://localhost:${port}/demo`);
}

bootstrap();
