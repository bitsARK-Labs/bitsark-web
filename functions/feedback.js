/**
 * feedback.js - Cloudflare Pages Function
 * Processa reports de dados incorretos e feedback do usuário.
 */

const esc = (s) => String(s ?? '')
  .replace(/&/g, '&amp;')
  .replace(/</g, '&lt;')
  .replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;')
  .replace(/'/g, '&#39;');

export const onRequestOptions = async () => {
  return new Response(null, {
    status: 204,
    headers: {
      'Access-Control-Allow-Origin': 'https://bitsark.com',
      'Access-Control-Allow-Methods': 'POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
      'Access-Control-Max-Age': '86400',
    },
  });
};

export const onRequestPost = async ({ request, env }) => {
  const origin = request.headers.get('Origin');
  
  // Permitir apenas produção e localhost para testes
  if (origin !== 'https://bitsark.com' && !origin?.startsWith('http://localhost')) {
    return new Response('Forbidden', { status: 403 });
  }

  try {
    const data = await request.json();
    const { type, message, page, hp, email } = data;

    // 1. Honeypot check (anti-spam)
    if (hp) {
      return new Response(JSON.stringify({ success: true, note: 'Filtered' }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    // 2. Validação básica
    if (!type || !message || message.length < 5) {
      return new Response('Invalid data', { status: 400 });
    }

    // 3. Rate Limit (1 req/min por IP) usando KV
    const ip = request.headers.get('CF-Connecting-IP');
    if (env.RATE_LIMIT_KV) {
      const lastReq = await env.RATE_LIMIT_KV.get(ip);
      if (lastReq) {
        return new Response('Too many requests', { status: 429 });
      }
      await env.RATE_LIMIT_KV.put(ip, '1', { expirationTtl: 60 });
    }

    const payload = {
      type,
      message,
      page: page || request.headers.get('Referer'),
      email: email || 'anonymous',
      timestamp: new Date().toISOString(),
      ip
    };

    // 4. Persistência em KV (opcional)
    if (env.FEEDBACK_KV) {
      const id = crypto.randomUUID();
      await env.FEEDBACK_KV.put(id, JSON.stringify(payload));
    }

    // 5. Envio de Email via Resend API
    if (env.RESEND_API_KEY && env.EMAIL_TO) {
      await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${env.RESEND_API_KEY}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          from: 'bitsARK System <system@bitsark.com>',
          to: [env.EMAIL_TO],
          subject: `🚀 Feedback bitsARK: ${esc(type)}`,
          html: `
            <h2>Novo Feedback Recebido</h2>
            <p><strong>Página:</strong> ${esc(payload.page)}</p>
            <p><strong>Tipo:</strong> ${esc(type)}</p>
            <p><strong>Mensagem:</strong> ${esc(message)}</p>
            <p><strong>Usuário:</strong> ${esc(payload.email)}</p>
            <hr />
            <p><small>Enviado via bitsARK Functions (Cloudflare)</small></p>
          `
        })
      });
    }

    return new Response(JSON.stringify({ success: true }), {
      status: 200,
      headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': 'https://bitsark.com' }
    });
  } catch (err) {
    return new Response('Internal Error', { status: 500 });
  }
};