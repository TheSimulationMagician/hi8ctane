// Reads the environment once per call. Every value is optional: the site still serves without them.
export function env() {
  const e = process.env;
  const key = (e.SUPABASE_SECRET_KEY || e.SUPABASE_SERVICE_ROLE_KEY || '').trim();
  return {
    siteUrl: (e.SITE_URL || 'https://hi8ctane.com').replace(/\/$/, ''),
    supabaseUrl: (e.SUPABASE_URL || '').replace(/\/$/, ''),
    supabaseKey: key,
    hasDb: Boolean(e.SUPABASE_URL && key),
    meteoKey: (e.OPEN_METEO_API_KEY || '').trim(),
    forecastOff: e.FORECAST_OFF === '1' || e.FORECAST_OFF === 'true',
    resendKey: (e.RESEND_API_KEY || '').trim(),
    mailFrom: e.MAIL_FROM || 'Hi8ctane <hello@send.hi8ctane.com>',
    mailReplyTo: e.MAIL_REPLY_TO || 'hello@hi8ctane.com',
  };
}
