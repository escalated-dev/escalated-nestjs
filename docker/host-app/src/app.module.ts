import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { EscalatedModule } from '@escalated-dev/escalated-nestjs';

import { User } from './user.entity';
import { DemoController } from './demo.controller';

@Module({
  imports: [
    TypeOrmModule.forRoot({
      type: 'postgres',
      host: process.env.DB_HOST || 'db',
      port: parseInt(process.env.DB_PORT || '5432', 10),
      username: process.env.DB_USER || 'escalated',
      password: process.env.DB_PASSWORD || 'escalated',
      database: process.env.DB_NAME || 'escalated',
      entities: [
        User,
        '/host/node_modules/@escalated-dev/escalated-nestjs/dist/entities/*.entity.js',
      ],
      synchronize: true,
      logging: false,
    }),
    TypeOrmModule.forFeature([User]),
    EscalatedModule.forRoot({
      userEntity: User,
      userResolver: (req) => {
        const id = parseInt(req.cookies?.demo_user_id || '0', 10);
        if (!id) return null;
        return { id, name: 'Demo User', email: 'demo@demo.test' };
      },
      appName: 'Escalated NestJS Demo',
    }),
  ],
  controllers: [DemoController],
})
export class AppModule {}
