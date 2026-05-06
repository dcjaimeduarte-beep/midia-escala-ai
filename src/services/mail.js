/**
 * Envio de e-mail (Nodemailer). Sem SMTP no .env, apenas registra no console.
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

  const host = process.env.SMTP_HOST
  if (!host) {
    console.warn(
      `[email] SMTP não configurado — e-mail NÃO enviado para ${para}. Senha provisória: ${senhaTemporaria}`
    )
    return { enviado: false, motivo: 'smtp_desligado' }
  }

  const nodemailer = require('nodemailer')
  const secureFlag = process.env.SMTP_SECURE
  const secure =
    secureFlag === '1' ||
    String(secureFlag || '').toLowerCase() === 'true'

  const transporter = nodemailer.createTransport({
    host,
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

/**
 * Notifica membros sobre novo comunicado (mesmo SMTP dos convites).
 * Sem SMTP_HOST, apenas avisa no log (como enviarBoasVindas).
 */
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

  const host = process.env.SMTP_HOST
  if (!host) {
    console.warn(
      `[email] SMTP não configurado — comunicado por e-mail NÃO enviado para ${para}`
    )
    return { enviado: false, motivo: 'smtp_desligado' }
  }

  const nodemailer = require('nodemailer')
  const secureFlag = process.env.SMTP_SECURE
  const secure =
    secureFlag === '1' ||
    String(secureFlag || '').toLowerCase() === 'true'

  const transporter = nodemailer.createTransport({
    host,
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

module.exports = { enviarBoasVindas, enviarComunicadoAviso }
