import { Module } from '@nestjs/common';
import { HttpExceptionFilter } from './filters/http-exception.filter';
import { APP_FILTER } from '@nestjs/core';
import { FeeRepository } from './repositories/fee.repository';
import { MockFeeRepository } from './repositories/mock-fee.repository';

@Module({
  providers: [
    // Global exception filter for consistent error responses
    {
      provide: APP_FILTER,
      useClass: HttpExceptionFilter,
    },
    // Fee repository - swap MockFeeRepository for real ERP integration
    {
      provide: FeeRepository,
      useClass: MockFeeRepository,
    },
  ],
  exports: [FeeRepository],
})
export class CommonModule {}
