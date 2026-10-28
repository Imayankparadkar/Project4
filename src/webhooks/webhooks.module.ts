import { Module } from '@nestjs/common';
import { WebhooksController } from './webhooks.controller';
import { WebhooksService } from './webhooks.service';
import { CashfreeModule } from '../cashfree/cashfree.module';
import { PaymentsModule } from '../payments/payments.module';

@Module({
  imports: [CashfreeModule, PaymentsModule],
  controllers: [WebhooksController],
  providers: [WebhooksService],
})
export class WebhooksModule {}
