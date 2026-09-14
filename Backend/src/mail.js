import nodemailer from 'nodemailer';

export function configuredMailer(env = process.env, { fetch: request = globalThis.fetch } = {}) {
  if (env.RESEND_API_KEY || env.RESEND_FROM) {
    if (!env.RESEND_API_KEY || !env.RESEND_FROM) return null;
    return async (email, code) => {
      const response = await request('https://api.resend.com/emails', {
        method: 'POST', redirect: 'error', signal: AbortSignal.timeout(20000),
        headers: { Authorization: `Bearer ${env.RESEND_API_KEY}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ from: env.RESEND_FROM, to: [email],
          subject: 'Seu código de acesso ao Luxlab',
          text: `Seu código de acesso é: ${code}\n\nEle expira em 10 minutos e só pode ser usado uma vez.\nSe você não solicitou este código, ignore este e-mail.` })
      });
      if (!response.ok) throw new Error(`Resend recusou o envio (HTTP ${response.status}).`);
      const result = await response.json();
      if (typeof result?.id !== 'string' || !result.id) throw new Error('Resend não confirmou o envio.');
    };
  }
  if (!env.SMTP_HOST || !env.SMTP_FROM) return null;
  const port = Number(env.SMTP_PORT || 587);
  const transport = nodemailer.createTransport({
    host: env.SMTP_HOST, port, secure: port === 465, requireTLS: port !== 465,
    ...(env.SMTP_USER ? { auth: { user: env.SMTP_USER, pass: env.SMTP_PASS } } : {}),
    connectionTimeout: 10000, greetingTimeout: 10000, socketTimeout: 20000,
    disableFileAccess: true, disableUrlAccess: true
  });
  return async (email, code) => {
    const result = await transport.sendMail({ from: env.SMTP_FROM, to: { address: email, name: '' },
      subject: 'Seu código de acesso ao Luxlab',
      text: `Seu código de acesso é: ${code}\n\nEle expira em 10 minutos e só pode ser usado uma vez.\nSe você não solicitou este código, ignore este e-mail.` });
    if (!result.accepted?.length) throw new Error('SMTP não aceitou o destinatário.');
  };
}
