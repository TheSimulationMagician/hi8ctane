/*
 * Hi8ctane live settings, read by live.js.
 *
 * With supabaseUrl and publishableKey empty, the site runs as a sample: nothing anyone types is saved.
 * Fill both in (Supabase > Project Settings > API Keys) and every sign-up is saved to Supabase.
 *
 * The publishable key is made to sit in a public website. NEVER put the secret key (sb_secret_…) here.
 */
window.HI8_CONFIG = {
  // e.g. "https://abcdefghijklmnop.supabase.co"
  supabaseUrl: "",
  // e.g. "sb_publishable_…" (an older project's "anon public" key works too)
  publishableKey: "",

  // Switch on once Supabase Auth can send email (Authentication > SMTP, e.g. with Resend):
  // "EMAIL ME A LINK" then really emails a one-tap sign-in link.
  emailLink: false,
  // Switch on once Google is set up in Authentication > Sign In / Providers:
  // "CONTINUE WITH GOOGLE" then signs in with Google.
  google: false
};
