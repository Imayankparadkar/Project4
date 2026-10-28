import { Module } from '@nestjs/common';
import { PaymentsController } from './payments.controller';
import { PaymentsService } from './payments.service';
import { PaymentsRepository } from './payments.repository';
import { CashfreeModule } from '../cashfree/cashfree.module';
import { CommonModule } from '../common/common.module';

@Module({
  imports: [CashfreeModule, CommonModule],
  controllers: [PaymentsController],
  providers: [PaymentsService, PaymentsRepository],
  exports: [PaymentsService],
})
export class PaymentsModule {}
