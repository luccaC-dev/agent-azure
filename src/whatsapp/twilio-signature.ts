import { createHmac } from 'node:crypto';
import { safeEqual } from '../http/guards';

/**
 * Twilio's request signature: HMAC-SHA1 over the full public URL followed by every POST
 * parameter (sorted by name, name+value concatenated), base64-encoded, keyed with the auth token.
 */
export function twilioSignature(authToken: string, url: string, params: Record<string, string>): string {
  const payload = Object.keys(params)
    .sort()
    .reduce((acc, k) => acc + k + params[k], url);
  return createHmac('sha1', authToken).update(Buffer.from(payload, 'utf8')).digest('base64');
}

export function isValidTwilioRequest(authToken: string, signature: string, url: string, params: Record<string, string>): boolean {
  return safeEqual(twilioSignature(authToken, url, params), signature);
}

/**
 * The URL Twilio signed is the public one. Behind Container Apps ingress the app sees plain HTTP
 * on an internal host, so prefer an explicit PUBLIC_BASE_URL, then forwarded headers.
 */
export function publicRequestUrl(
  req: { protocol: string; originalUrl: string; get(name: string): string | undefined },
  publicBaseUrl?: string,
): string {
  if (publicBaseUrl) return publicBaseUrl.replace(/\/+$/, '') + req.originalUrl;
  const host = req.get('x-forwarded-host') ?? req.get('host');
  return `${req.protocol}://${host}${req.originalUrl}`;
}
