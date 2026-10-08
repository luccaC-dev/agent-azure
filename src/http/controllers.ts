import {
  BadRequestException,
  Body,
  ConflictException,
  Controller,
  Get,
  Headers,
  HttpCode,
  Inject,
  NotFoundException,
  Param,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { z } from 'zod';
import { APP_CONTEXT, AppContext } from '../app-context';
import { ConflictError, NotFoundError } from '../domain/approvals';
import { AdminGuard, ChatKeyGuard } from './guards';

function parse<T extends z.ZodTypeAny>(schema: T, value: unknown): z.infer<T> {
  const r = schema.safeParse(value);
  if (!r.success) throw new BadRequestException(r.error.issues.map((i) => `${i.path.join('.') || 'body'}: ${i.message}`));
  return r.data;
}

@Controller()
export class HealthController {
  constructor(@Inject(APP_CONTEXT) private readonly ctx: AppContext) {}

  @Get('healthz')
  health() {
    return { status: 'ok', provider: this.ctx.provider.name, model: this.ctx.provider.model };
  }
}

const messageBody = z.object({
  customer_id: z.string().min(1).max(64),
  message: z.string().trim().min(1).max(2000),
});

@Controller('v1/conversations')
@UseGuards(ChatKeyGuard)
export class ConversationsController {
  constructor(@Inject(APP_CONTEXT) private readonly ctx: AppContext) {}

  @Post(':id/messages')
  @HttpCode(200)
  async send(@Param('id') id: string, @Body() body: unknown) {
    const { customer_id, message } = parse(messageBody, body);
    const conv = this.ctx.conversations.get(id);
    if (conv && conv.customerId !== customer_id) throw new ConflictException('conversation belongs to another customer');
    const customer = this.ctx.store.customer(customer_id);
    if (!customer) throw new NotFoundException('unknown customer');

    const conversation = conv ?? { id, customerId: customer.id, customerName: customer.name, messages: [] };
    this.ctx.conversations.set(id, conversation);
    const r = await this.ctx.agent.reply(conversation, message);
    return {
      reply: r.text,
      tool_calls: r.toolCalls,
      stopped_reason: r.stoppedReason,
      usage: { input_tokens: r.usage.inputTokens, output_tokens: r.usage.outputTokens },
      cost_usd: r.costUsd,
    };
  }
}

@Controller('v1/admin')
@UseGuards(AdminGuard)
export class AdminController {
  constructor(@Inject(APP_CONTEXT) private readonly ctx: AppContext) {}

  @Get('approvals')
  approvals(@Query('status') status?: string) {
    const s = parse(z.enum(['pending', 'approved', 'rejected']).optional(), status || undefined);
    return this.ctx.approvals.list(s);
  }

  @Post('approvals/:id/:decision')
  @HttpCode(200)
  decide(@Param('id') id: string, @Param('decision') decision: string, @Headers('x-admin-actor') actor?: string) {
    const d = parse(z.enum(['approve', 'reject']), decision);
    try {
      return this.ctx.approvals.decide(id, d === 'approve', (actor || 'admin').slice(0, 100));
    } catch (err) {
      if (err instanceof NotFoundError) throw new NotFoundException(err.message);
      if (err instanceof ConflictError) throw new ConflictException(err.message);
      throw err;
    }
  }

  @Get('tickets')
  tickets() {
    return this.ctx.tickets.all();
  }
}
