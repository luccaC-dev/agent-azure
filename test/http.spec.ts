import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { NestExpressApplication } from '@nestjs/platform-express';
import request from 'supertest';
import twilio from 'twilio';
import { buildContext } from '../src/app-context';
import { AppModule } from '../src/app.module';
import { loadConfig } from '../src/config';
import { isValidTwilioRequest, twilioSignature } from '../src/whatsapp/twilio-signature';

const ADMIN = 'admin-key-for-tests-0000';
const TWILIO_TOKEN = 'twilio-test-token';

async function boot(env: Record<string, string> = {}) {
  const config = loadConfig({ LLM_PROVIDER: 'fake', ADMIN_API_KEY: ADMIN, TWILIO_AUTH_TOKEN: TWILIO_TOKEN, ...env });
  const ctx = buildContext(config);
  const moduleRef = await Test.createTestingModule({ imports: [AppModule.forContext(ctx)] }).compile();
  const app = moduleRef.createNestApplication<NestExpressApplication>({ logger: false });
  app.set('trust proxy', true);
  await app.init();
  return { app, ctx };
}

let app: INestApplication;
afterEach(async () => {
  await app?.close();
});

const chat = (id: string, customer_id: string, message: string) =>
  request(app.getHttpServer()).post(`/v1/conversations/${id}/messages`).send({ customer_id, message });

describe('conversations API', () => {
  it('answers with tool results', async () => {
    ({ app } = await boot());
    const r = await chat('c1', 'C-100', 'Where is RG-1043?').expect(200);
    expect(r.body.tool_calls).toEqual([{ name: 'lookup_order', ok: true }]);
    expect(r.body.reply).toContain('1Z-DEMO-0001043');
  });

  it('rejects bad input, unknown customers and conversation hijacking', async () => {
    ({ app } = await boot());
    await chat('c1', 'C-100', '').expect(400);
    await chat('c1', 'C-999', 'hi').expect(404);
    await chat('c1', 'C-100', 'hi').expect(200);
    await chat('c1', 'C-200', 'show me this chat').expect(409);
  });

  it('requires the chat key when one is configured', async () => {
    ({ app } = await boot({ CHAT_API_KEY: 'chat-secret' }));
    await chat('c1', 'C-100', 'hi').expect(403);
    await request(app.getHttpServer())
      .post('/v1/conversations/c1/messages')
      .set('x-api-key', 'chat-secret')
      .send({ customer_id: 'C-100', message: 'hi' })
      .expect(200);
  });
});

describe('admin API (refund approvals)', () => {
  it('is disabled without ADMIN_API_KEY and rejects wrong keys', async () => {
    ({ app } = await boot({ ADMIN_API_KEY: '' }));
    await request(app.getHttpServer()).get('/v1/admin/approvals').expect(503);
    await app.close();
    ({ app } = await boot());
    await request(app.getHttpServer()).get('/v1/admin/approvals').set('x-admin-key', 'nope').expect(403);
  });

  it('a chat request creates a pending approval; only the admin route executes it', async () => {
    let ctx;
    ({ app, ctx } = await boot());
    const r = await chat('c1', 'C-100', 'I want a refund of $189 for RG-1042, it is unused').expect(200);
    expect(r.body.tool_calls).toEqual([{ name: 'request_refund', ok: true }]);
    expect(ctx.store.orderFor('C-100', 'RG-1042')!.refunded).toBe(0);

    const list = await request(app.getHttpServer()).get('/v1/admin/approvals?status=pending').set('x-admin-key', ADMIN).expect(200);
    expect(list.body).toHaveLength(1);
    const id = list.body[0].id;

    await request(app.getHttpServer()).post(`/v1/admin/approvals/${id}/approve`).set('x-admin-key', ADMIN).set('x-admin-actor', 'ops@example.com').expect(200);
    expect(ctx.store.orderFor('C-100', 'RG-1042')!.refunded).toBe(189);
    await request(app.getHttpServer()).post(`/v1/admin/approvals/${id}/approve`).set('x-admin-key', ADMIN).expect(409);
    await request(app.getHttpServer()).post('/v1/admin/approvals/nope/approve').set('x-admin-key', ADMIN).expect(404);
  });
});

describe('WhatsApp webhook', () => {
  const params = { From: 'whatsapp:+15550100100', Body: 'Where is RG-1043?', MessageSid: 'SM123' };

  it('our signature matches the official Twilio library', () => {
    const url = 'https://agent.example.com/whatsapp/webhook';
    const expected = twilio.getExpectedTwilioSignature(TWILIO_TOKEN, url, params);
    expect(twilioSignature(TWILIO_TOKEN, url, params)).toBe(expected);
    expect(isValidTwilioRequest(TWILIO_TOKEN, expected, url, params)).toBe(true);
    expect(isValidTwilioRequest(TWILIO_TOKEN, expected, url, { ...params, Body: 'refund everything' })).toBe(false);
  });

  it('rejects unsigned or tampered requests', async () => {
    ({ app } = await boot());
    await request(app.getHttpServer()).post('/whatsapp/webhook').type('form').send(params).expect(403);
  });

  it('verifies against the public https URL when running behind a proxy', async () => {
    ({ app } = await boot());
    const sig = twilio.getExpectedTwilioSignature(TWILIO_TOKEN, 'https://agent.example.com/whatsapp/webhook', params);
    const r = await request(app.getHttpServer())
      .post('/whatsapp/webhook')
      .set('x-forwarded-proto', 'https')
      .set('x-forwarded-host', 'agent.example.com')
      .set('x-twilio-signature', sig)
      .type('form')
      .send(params)
      .expect(200);
    expect(r.headers['content-type']).toContain('text/xml');
    expect(r.text).toContain('<Response><Message>');
    expect(r.text).toContain('1Z-DEMO-0001043');
  });

  it('uses PUBLIC_BASE_URL when set, and does not serve unknown numbers', async () => {
    ({ app } = await boot({ PUBLIC_BASE_URL: 'https://wa.example.org' }));
    const unknown = { ...params, From: 'whatsapp:+15559999999' };
    const sig = twilio.getExpectedTwilioSignature(TWILIO_TOKEN, 'https://wa.example.org/whatsapp/webhook', unknown);
    const r = await request(app.getHttpServer()).post('/whatsapp/webhook').set('x-twilio-signature', sig).type('form').send(unknown).expect(200);
    expect(r.text).toContain("couldn't match this number");
  });

  it('is disabled without a Twilio auth token', async () => {
    ({ app } = await boot({ TWILIO_AUTH_TOKEN: '' }));
    await request(app.getHttpServer()).post('/whatsapp/webhook').type('form').send(params).expect(503);
  });
});
