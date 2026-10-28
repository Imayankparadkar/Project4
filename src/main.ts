import { NestFactory } from '@nestjs/core';
import { ValidationPipe, Logger } from '@nestjs/common';
import { SwaggerModule, DocumentBuilder } from '@nestjs/swagger';
import { AppModule } from './app.module';
import { ConfigService } from '@nestjs/config';
import helmet from 'helmet';

async function bootstrap() {
  const logger = new Logger('Bootstrap');

  // Create app with raw body parsing enabled for webhook signature verification
  const app = await NestFactory.create(AppModule, {
    rawBody: true,
    bodyParser: true,
  });

  const configService = app.get(ConfigService);
  const port = configService.get<number>('PORT', 3000);
  const nodeEnv = configService.get<string>('NODE_ENV', 'development');
  const frontendOrigin = configService.get<string>('FRONTEND_ORIGIN', 'http://localhost:3001');

  // Security headers
  app.use(helmet());

  // CORS - restrictive by default
  app.enableCors({
    origin: nodeEnv === 'production' ? frontendOrigin : [frontendOrigin, 'http://localhost:3000'],
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'],
    allowedHeaders: ['Content-Type', 'Authorization', 'x-idempotency-key'],
    credentials: true,
    maxAge: 3600,
  });

  // Global prefix
  app.setGlobalPrefix('api/v1');

  // Global validation pipe
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
      transformOptions: {
        enableImplicitConversion: false,
      },
      stopAtFirstError: false,
    }),
  );

  // Swagger API documentation
  const swaggerConfig = new DocumentBuilder()
    .setTitle('TrainX Payment Module')
    .setDescription(
      'Cashfree Payment Integration API for University Management System (UMS/ERP). ' +
        'Handles payment creation, verification, webhook processing, and ERP fee settlement.',
    )
    .setVersion('1.0.0')
    .addTag('Payments', 'Payment creation, status, and verification endpoints')
    .addTag('Webhooks', 'Cashfree webhook receiver')
    .addTag('Health', 'Application health check')
    .addBearerAuth(
      {
        type: 'http',
        scheme: 'bearer',
        bearerFormat: 'JWT',
        description: 'Development auth token (student ID)',
      },
      'bearer',
    )
    .build();

  const document = SwaggerModule.createDocument(app, swaggerConfig);
  SwaggerModule.setup('api/docs', app, document, {
    swaggerOptions: {
      persistAuthorization: true,
      tagsSorter: 'alpha',
      operationsSorter: 'alpha',
    },
  });

  await app.listen(port);
  logger.log(`🚀 Application running on http://localhost:${port}`);
  logger.log(`📚 Swagger docs at http://localhost:${port}/api/docs`);
  logger.log(`🌍 Environment: ${nodeEnv}`);
}
bootstrap();
