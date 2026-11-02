// GET /api/health → what's switched on. Shows no secrets.
import { env } from './_lib/env.js';
import { json } from './_lib/http.js';
import { endpoints } from './_lib/forecast.js';

export function GET() {
  const cfg = env();
  return json({ ok: true, version: '0.1.0', database: cfg.hasDb, forecast: cfg.forecastOff ? 'off' : endpoints(cfg).licence, email: Boolean(cfg.resendKey) });
}
