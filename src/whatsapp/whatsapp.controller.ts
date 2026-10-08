import { Body, Controller, ForbiddenException, Header, HttpCode, Inject, Post, Req, ServiceUnavailableException } from '@nestjs/common';
import { Request } from 'express';
import { APP_CONTEXT, AppContext } from '../app-context';
import { isValidTwilioRequest, publicRequestUrl } from './twilio-signature';

/** Twilio caps a WhatsApp message body at 1600 characters. */
const MAX_REPLY = 1500;

export function twiml(message: string): string {
  const escaped = message
    .slice(0, MAX_REPLY)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
  return `<?xml version="1.0" encoding="UTF-8"?><Response><Message>${escaped}</Message></Response>`;
}

/**
 * Twilio WhatsApp webhook. The sender's number identifies the customer; the message text never can.
 * Replies synchronously with TwiML, which is fine for a demo. Twilio waits up to 15 seconds, so a
 * production version would acknowledge immediately and send the answer through the Messages API.
 */
@Controller('whatsapp')
export class WhatsAppController {
  constructor(@Inject(APP_CONTEXT) private readonly ctx: AppContext) {}

  @Post('webhook')
  @HttpCode(200)
  @Header('content-type', 'text/xml')
  async webhook(@Req() req: Request, @Body() body: Record<string, string>): Promise<string> {
    const token = this.ctx.config.TWILIO_AUTH_TOKEN;
    if (!token) throw new ServiceUnavailableException('WhatsApp channel is disabled: set TWILIO_AUTH_TOKEN');
    const signature = req.header('x-twilio-signature') ?? '';
    const url = publicRequestUrl(req, this.ctx.config.PUBLIC_BASE_URL);
    if (!isValidTwilioRequest(token, signature, url, body ?? {})) throw new ForbiddenException('invalid Twilio signature');

    const phone = String(body.From ?? '').replace(/^whatsapp:/, '');
    const text = String(body.Body ?? '').trim();
    const customer = this.ctx.store.customerByPhone(phone);
    if (!customer) return twiml("Sorry, I couldn't match this number to a Ridgeline Gear account.");
    if (!text) return twiml('Hi! Send me your question about an order, shipping, returns or warranty.');

    const id = `wa:${phone}`;
    const conversation = this.ctx.conversations.get(id) ?? { id, customerId: customer.id, customerName: customer.name, messages: [] };
    this.ctx.conversations.set(id, conversation);
    const r = await this.ctx.agent.reply(conversation, text.slice(0, 2000));
    return twiml(r.text);
  }
}
