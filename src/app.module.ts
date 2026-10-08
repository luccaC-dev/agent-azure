import { DynamicModule, Module } from '@nestjs/common';
import { APP_CONTEXT, AppContext } from './app-context';
import { AdminController, ConversationsController, HealthController } from './http/controllers';
import { AdminGuard, ChatKeyGuard } from './http/guards';
import { WhatsAppController } from './whatsapp/whatsapp.controller';

@Module({})
export class AppModule {
  static forContext(ctx: AppContext): DynamicModule {
    return {
      module: AppModule,
      controllers: [HealthController, ConversationsController, AdminController, WhatsAppController],
      providers: [{ provide: APP_CONTEXT, useValue: ctx }, AdminGuard, ChatKeyGuard],
    };
  }
}
