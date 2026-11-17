// Outgoing email. No provider is wired in yet: until one is (Resend, SES, SMTP…), messages are printed to the
// server console in development and dropped with a warning in production — reset links never go to prod logs.

const PROD = process.env.NODE_ENV === "production";

export async function sendPasswordResetEmail({ to, name, link, invite = false }) {
  // TODO: send through your email provider here.
  if (PROD) {
    console.warn(`[mail] no email provider configured — ${invite ? "invite" : "password reset"} email to ${to} not sent`);
    return;
  }
  console.log(`[mail] ${invite ? "Invite" : "Password reset"} for ${name || to} <${to}>: ${link}`);
}
