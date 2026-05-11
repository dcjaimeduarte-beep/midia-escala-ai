async function _enviarViaResend({ para, assunto, texto }) {
  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${process.env.RESEND_API_KEY}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      from: process.env.SMTP_FROM || 'Peniel Mídia <onboarding@resend.dev>',
      to: [para],
      subject: assunto,
      text: texto
    })
  })
  if (!res.ok) {
    const err = await res.json().catch(() => ({}))
    throw new Error(`Resend: ${err?.message || res.status}`)
  }
  return { enviado: true }
}

async function _enviarViaSMTP({ para, assunto, texto }) {
  const nodemailer = require('nodemailer')
  const secureFlag = process.env.SMTP_SECURE
  const secure = secureFlag === '1' || String(secureFlag || '').toLowerCase() === 'true'
  const transporter = nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port: Number(process.env.SMTP_PORT || 587),
    secure,
    auth: process.env.SMTP_USER
      ? { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS || '' }
      : undefined
  })
  await transporter.sendMail({
    from: process.env.SMTP_FROM || process.env.SMTP_USER,
    to: para,
    subject: assunto,
    text: texto
  })
  return { enviado: true }
}

async function _enviar({ para, assunto, texto }) {
  if (process.env.RESEND_API_KEY) return _enviarViaResend({ para, assunto, texto })
  if (process.env.SMTP_HOST)      return _enviarViaSMTP({ para, assunto, texto })
  console.warn(`[email] Sem provedor configurado — e-mail NÃO enviado para ${para}`)
  return { enviado: false, motivo: 'sem_provedor' }
}

/**
 * Envio de e-mail. Suporta Resend (RESEND_API_KEY) ou SMTP (SMTP_HOST).
 */
async function enviarBoasVindas({ para, nome, senhaTemporaria, mensagemExtra }) {
  const urlLogin =
    process.env.APP_PUBLIC_URL || `http://localhost:${process.env.PORT || 3000}`

  const extra =
    mensagemExtra && String(mensagemExtra).trim()
      ? `\n\n— Mensagem da liderança —\n${String(mensagemExtra).trim()}\n`
      : ''

  const assunto = 'Peniel Mídia — sua conta foi criada'
  const texto = `Olá, ${nome}!

Sua conta no sistema de gestão da equipe de mídia está pronta.

Acesse: ${urlLogin}
E-mail: ${para}
Senha provisória: ${senhaTemporaria}

Por segurança, ao entrar você precisará definir uma nova senha.${extra}
Shalom,
Equipe Peniel Mídia`

  return _enviar({ para, assunto, texto })
}

async function enviarComunicadoAviso({
  para,
  nomeDestinatario,
  titulo,
  corpo,
  departamentoNome
}) {
  const urlApp =
    process.env.APP_PUBLIC_URL || `http://localhost:${process.env.PORT || 3000}`

  const trecho =
    String(corpo || '').length > 900
      ? `${String(corpo).slice(0, 897)}...`
      : String(corpo || '')

  const escopo = departamentoNome
    ? `Departamento: ${departamentoNome}`
    : 'Aviso geral da equipe'

  const linhaTitulo = titulo && String(titulo).trim() ? String(titulo).trim() : ''
  const assunto = linhaTitulo
    ? `Peniel Mídia — ${linhaTitulo}`
    : 'Peniel Mídia — novo comunicado'

  const texto = `Olá, ${nomeDestinatario || 'irmão(ã)'}!

Há um novo comunicado no app Peniel Mídia.

${escopo}
${linhaTitulo ? `Assunto: ${linhaTitulo}` : ''}

---
${trecho}
---

Abra o sistema para ver o comunicado completo: ${urlApp}

Shalom,
Equipe Peniel Mídia`

  return _enviar({ para, assunto, texto })
}

async function enviarBackupEmail({ para, nomeArquivo, conteudoJson }) {
  const assunto = `Peniel Mídia — backup automático ${nomeArquivo}`
  const texto   = `Backup automático do sistema Peniel Mídia.\n\nArquivo: ${nomeArquivo}\nGerado em: ${new Date().toLocaleString('pt-BR')}\n\nO backup está anexado a este e-mail.`
  const b64     = Buffer.from(conteudoJson, 'utf8').toString('base64')

  if (process.env.RESEND_API_KEY) {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${process.env.RESEND_API_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        from: process.env.SMTP_FROM || 'Peniel Mídia <onboarding@resend.dev>',
        to: [para], subject: assunto, text: texto,
        attachments: [{ filename: nomeArquivo, content: b64 }]
      })
    })
    if (!res.ok) { const e = await res.json().catch(() => ({})); throw new Error(`Resend: ${e?.message || res.status}`) }
    return { enviado: true }
  }

  if (process.env.SMTP_HOST) {
    const nodemailer = require('nodemailer')
    const secure = process.env.SMTP_SECURE === '1' || String(process.env.SMTP_SECURE || '').toLowerCase() === 'true'
    const t = nodemailer.createTransport({
      host: process.env.SMTP_HOST, port: Number(process.env.SMTP_PORT || 587), secure,
      auth: process.env.SMTP_USER ? { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS || '' } : undefined
    })
    await t.sendMail({
      from: process.env.SMTP_FROM || process.env.SMTP_USER, to: para,
      subject: assunto, text: texto,
      attachments: [{ filename: nomeArquivo, content: Buffer.from(conteudoJson, 'utf8'), contentType: 'application/json' }]
    })
    return { enviado: true }
  }

  return { enviado: false, motivo: 'sem_provedor' }
}

module.exports = { enviarBoasVindas, enviarComunicadoAviso, enviarBackupEmail }
