const express = require('express')
const router = express.Router()
const { v4: uuid } = require('uuid')
const sql = require('../db/database')
const { autenticar } = require('../auth/middleware')
const eventBus = require('../events/eventBus')
const { enviarComunicadoAviso } = require('../services/mail')
const { listarDestinatariosAviso } = require('../services/avisoDestinatarios')
const {
  digitosWhatsApp,
  enviarComunicadoWhatsApp,
  whatsappEstaConfigurado,
  garantirConexaoWhatsApp,
  statusWhatsApp,
  reconectarWhatsApp,
  imprimirQrNoTerminal
} = require('../services/whatsapp')
const {
  avisoDentroDoPeriodoAtivo,
  validarPeriodoAviso
} = require('../services/avisoPeriodo')

const envioStatusPorAviso = new Map()

function clonarStatusEnvio(status) {
  if (!status) return null
  return JSON.parse(JSON.stringify(status))
}

function atualizarSituacaoGeral(status) {
  if (!status) return
  const pendenteEmail = status.email.pendentes > 0
  const pendenteZap = status.whatsapp.pendentes > 0
  status.situacao = pendenteEmail || pendenteZap ? 'processando' : 'concluido'
  status.atualizado_em = new Date().toISOString()
}

function withTimeout(promise, ms = 45000) {
  return Promise.race([
    promise,
    new Promise((resolve) => setTimeout(() => resolve(false), ms))
  ])
}

function podeGerirAviso(usuario, aviso) {
  if (!usuario || !aviso) return false
  if (usuario.role === 'admin') return true
  const ehAutor = aviso.autor_id === usuario.id
  const liderDoDepto =
    !!aviso.departamento_id &&
    !!sql.get(
      `SELECT 1 FROM usuario_departamento WHERE usuario_id = ? AND departamento_id = ? AND role_depto = 'lider'`,
      usuario.id,
      aviso.departamento_id
    )
  return ehAutor || liderDoDepto
}

function mapRow(r) {
  if (!r) return null
  return {
    ...r,
    departamento_nome: r.departamento_nome || null,
    autor_nome: r.autor_nome || null
  }
}

// GET /aviso/listar — todos os utilizadores autenticados veem os mesmos comunicados (como no painel admin).
// O campo departamento no aviso é informativo (“para qual equipa”). Notificações por e-mail/WhatsApp continuam segmentadas.
// ?incluir_encerrados=1 — inclui avisos fora do período (arquivo)
router.get('/listar', autenticar, (req, res) => {
  const incluirEncerrados = req.query.incluir_encerrados === '1'

  const rows = sql
    .all(
      `
      SELECT a.*, u.nome AS autor_nome, d.nome AS departamento_nome
      FROM avisos a
      LEFT JOIN usuarios u ON u.id = a.autor_id
      LEFT JOIN departamentos d ON d.id = a.departamento_id
      ORDER BY a.criado_em DESC
      LIMIT 120
    `
    )
    .map(mapRow)
    .map((a) => ({
      ...a,
      envio_status: clonarStatusEnvio(envioStatusPorAviso.get(a.id))
    }))

  const out = Array.isArray(rows) ? rows : []
  if (!incluirEncerrados) {
    return res.json(out.filter(avisoDentroDoPeriodoAtivo))
  }
  res.json(out)
})

router.get('/status/:id', autenticar, (req, res) => {
  const aviso = sql.get(`SELECT id FROM avisos WHERE id = ?`, req.params.id)
  if (!aviso) return res.status(404).json({ erro: 'Comunicado não encontrado' })
  res.json({
    aviso_id: req.params.id,
    envio_status: clonarStatusEnvio(envioStatusPorAviso.get(req.params.id))
  })
})

router.get('/whatsapp-status', autenticar, async (_req, res) => {
  garantirConexaoWhatsApp()
  res.json(statusWhatsApp())
})

router.post('/whatsapp-reconnect', autenticar, async (_req, res) => {
  await reconectarWhatsApp()
  res.json(statusWhatsApp())
})

router.post('/whatsapp-refresh-qr', autenticar, (_req, res) => {
  // Refresh seguro: reinicia sessão local e dispara nova tentativa limpa de QR.
  reconectarWhatsApp()
    .then(() => res.json({ ok: true, status: statusWhatsApp() }))
    .catch(() => res.json({ ok: false, status: statusWhatsApp() }))
})

// POST /aviso/criar — admin (qualquer destino) ou líder (só o seu departamento)
router.post('/criar', autenticar, (req, res) => {
  const {
    titulo,
    corpo,
    departamento_id,
    data_inicio,
    hora_inicio,
    data_fim,
    hora_fim,
    notificar_email,
    notificar_whatsapp,
    celular_manual
  } = req.body
  if (!corpo || !String(corpo).trim())
    return res.status(400).json({ erro: 'Escreva a mensagem (corpo).' })

  const di = data_inicio != null ? String(data_inicio).trim() : ''
  const hi = hora_inicio != null ? String(hora_inicio).trim() : ''
  const df = data_fim != null ? String(data_fim).trim() : ''
  const hf = hora_fim != null ? String(hora_fim).trim() : ''
  const val = validarPeriodoAviso({
    data_inicio: di,
    hora_inicio: hi,
    data_fim: df,
    hora_fim: hf
  })
  if (!val.ok) return res.status(400).json({ erro: val.erro })

  const uid = req.usuario.id
  const role = req.usuario.role
  let deptoDestino =
    departamento_id != null && String(departamento_id).trim() !== ''
      ? String(departamento_id).trim()
      : null

  if (role === 'admin') {
    if (deptoDestino) {
      const ex = sql.get(`SELECT id FROM departamentos WHERE id = ?`, deptoDestino)
      if (!ex) return res.status(404).json({ erro: 'Departamento não encontrado' })
    }
  } else {
    if (!deptoDestino)
      return res.status(400).json({ erro: 'Selecione o departamento do aviso.' })
    const ok = sql.get(
      `SELECT 1 FROM usuario_departamento WHERE usuario_id = ? AND departamento_id = ? AND role_depto = 'lider'`,
      uid,
      deptoDestino
    )
    if (!ok) return res.status(403).json({ erro: 'Só pode enviar avisos ao departamento em que é líder.' })
  }

  const id = uuid()
  const agora = new Date().toISOString()
  sql.run(
    `INSERT INTO avisos (id, titulo, corpo, departamento_id, autor_id, criado_em, data_inicio, hora_inicio, data_fim, hora_fim) VALUES (?,?,?,?,?,?,?,?,?,?)`,
    id,
    String(titulo || '').trim(),
    String(corpo).trim(),
    deptoDestino,
    uid,
    agora,
    di,
    hi,
    df,
    hf
  )

  const row = sql.get(
    `
    SELECT a.*, u.nome AS autor_nome, d.nome AS departamento_nome
    FROM avisos a
    LEFT JOIN usuarios u ON u.id = a.autor_id
    LEFT JOIN departamentos d ON d.id = a.departamento_id
    WHERE a.id = ?
  `,
    id
  )
  const mapped = mapRow(row)

  const querEmail =
    notificar_email !== false &&
    notificar_email !== '0' &&
    String(notificar_email || '').toLowerCase() !== 'false'

  const querZap =
    notificar_whatsapp === true ||
    notificar_whatsapp === 1 ||
    String(notificar_whatsapp || '').toLowerCase() === 'true'

  const tituloLinha = String(titulo || '').trim()
  const corpoTxt = String(corpo).trim()
  const deptNome = mapped.departamento_nome || null
  const destTodos = listarDestinatariosAviso(deptoDestino, uid)
  const destEmail = destTodos.filter((d) => d.email && String(d.email).trim())
  const whatsappDisponivel = whatsappEstaConfigurado()
  let destZap = querZap
    ? destTodos.filter((d) => digitosWhatsApp(d.celular))
    : []
  const semCelularEquipe = querZap ? Math.max(0, destTodos.length - destZap.length) : 0

  const manuaisBrutos = String(celular_manual || '')
    .split(/[\n,;]+/)
    .map((s) => s.trim())
    .filter(Boolean)
  const manuaisNormalizados = manuaisBrutos
    .map((c) => digitosWhatsApp(c))
    .filter(Boolean)
  const manuaisInvalidos = manuaisBrutos.length - manuaisNormalizados.length
  const existentes = new Set(destZap.map((d) => digitosWhatsApp(d.celular)).filter(Boolean))
  const manuaisUnicos = manuaisNormalizados.filter((n) => !existentes.has(n))
  const destZapManuais = manuaisUnicos.map((digits) => ({
    id: `manual:${digits}`,
    nome: 'Contato manual',
    celular: `+${digits}`
  }))
  destZap = [...destZap, ...destZapManuais]
  const semCelularZap = semCelularEquipe + manuaisInvalidos

  const statusEnvio = {
    aviso_id: id,
    criado_em: agora,
    atualizado_em: agora,
    situacao: querEmail || querZap ? 'processando' : 'sem_envio',
    email: {
      solicitado: !!querEmail,
      total: querEmail ? destEmail.length : 0,
      enviados: 0,
      falhas: 0,
      pendentes: querEmail ? destEmail.length : 0
    },
    whatsapp: {
      solicitado: !!querZap,
      provider_configurado: whatsappDisponivel,
      total: querZap ? destZap.length : 0,
      sem_celular: semCelularZap,
      manuais_adicionados: querZap ? destZapManuais.length : 0,
      enviados: 0,
      falhas: 0,
      pendentes: querZap && whatsappDisponivel ? destZap.length : 0,
      nao_enviados_provider: querZap && !whatsappDisponivel ? destZap.length : 0
    }
  }
  envioStatusPorAviso.set(id, statusEnvio)

  if (querEmail || querZap) {
    if (querZap && destZap.length && !whatsappDisponivel) {
      console.warn(
        '[aviso] WhatsApp solicitado mas WHATSAPP_PROVIDER / credenciais não estão no .env.'
      )
    }

    setImmediate(() => {
      const jobs = []

      if (querEmail && destEmail.length) {
        jobs.push(
          Promise.all(
            destEmail.map((d) =>
              withTimeout(
                enviarComunicadoAviso({
                  para: d.email,
                  nomeDestinatario: d.nome,
                  titulo: tituloLinha,
                  corpo: corpoTxt,
                  departamentoNome: deptNome
                }),
                30000
              )
                .then((r) => !!(r && r.enviado))
                .catch((e) => {
                  console.error(`[aviso] falha e-mail para ${d.email}:`, e.message)
                  return false
                })
            )
          ).then((results) => {
            statusEnvio.email.enviados = results.filter(Boolean).length
            statusEnvio.email.falhas = results.length - statusEnvio.email.enviados
            statusEnvio.email.pendentes = 0
            atualizarSituacaoGeral(statusEnvio)
            console.log(
              `[aviso] e-mail: ${statusEnvio.email.enviados}/${destEmail.length} enviados (SMTP)`
            )
          })
        )
      }

      if (querZap && destZap.length && whatsappDisponivel) {
        jobs.push(
          Promise.all(
            destZap.map((d) =>
              withTimeout(
                enviarComunicadoWhatsApp({
                  celular: d.celular,
                  nomeDestinatario: d.nome,
                  titulo: tituloLinha,
                  corpo: corpoTxt,
                  departamentoNome: deptNome
                }),
                45000
              )
                .then((r) => !!(r && r.enviado))
                .catch((e) => {
                  console.error(`[aviso] falha WhatsApp (${d.nome}):`, e.message)
                  return false
                })
            )
          ).then((results) => {
            statusEnvio.whatsapp.enviados = results.filter(Boolean).length
            statusEnvio.whatsapp.falhas = results.length - statusEnvio.whatsapp.enviados
            statusEnvio.whatsapp.pendentes = 0
            atualizarSituacaoGeral(statusEnvio)
            console.log(
              `[aviso] WhatsApp: ${statusEnvio.whatsapp.enviados}/${destZap.length} enviados`
            )
          })
        )
      }

      Promise.all(jobs)
        .then(() => atualizarSituacaoGeral(statusEnvio))
        .catch(() => atualizarSituacaoGeral(statusEnvio))
    })

    eventBus.emit('notificacao_equipe', {
      tipo: 'comunicado',
      mensagem: tituloLinha
        ? `Novo comunicado: ${tituloLinha}`
        : 'Novo comunicado publicado',
      destinatarios_email: querEmail ? destEmail.length : 0,
      destinatarios_whatsapp: destZap.length
    })
  }

  atualizarSituacaoGeral(statusEnvio)
  res.status(201).json({
    ...mapped,
    envio_status: clonarStatusEnvio(statusEnvio)
  })
})

// POST /aviso/:id/reenviar — reenvia um comunicado já publicado
router.post('/:id/reenviar', autenticar, (req, res) => {
  const { reenviar_email, reenviar_whatsapp } = req.body || {}
  const row = sql.get(
    `
    SELECT a.*, u.nome AS autor_nome, d.nome AS departamento_nome
    FROM avisos a
    LEFT JOIN usuarios u ON u.id = a.autor_id
    LEFT JOIN departamentos d ON d.id = a.departamento_id
    WHERE a.id = ?
  `,
    req.params.id
  )
  const aviso = mapRow(row)
  if (!aviso) return res.status(404).json({ erro: 'Comunicado não encontrado' })
  if (!podeGerirAviso(req.usuario, aviso)) {
    return res.status(403).json({ erro: 'Sem permissão para reenviar este comunicado' })
  }

  const querEmail =
    reenviar_email !== false &&
    reenviar_email !== '0' &&
    String(reenviar_email || '').toLowerCase() !== 'false'
  const querZap =
    reenviar_whatsapp !== false &&
    reenviar_whatsapp !== '0' &&
    String(reenviar_whatsapp || '').toLowerCase() !== 'false'
  if (!querEmail && !querZap) {
    return res.status(400).json({ erro: 'Selecione pelo menos um canal para reenvio.' })
  }
  const tituloLinha = String(aviso.titulo || '').trim()
  const corpoTxt = String(aviso.corpo || '').trim()
  const deptNome = aviso.departamento_nome || null
  const deptoDestino = aviso.departamento_id || null
  const autorId = aviso.autor_id
  const destTodos = listarDestinatariosAviso(deptoDestino, autorId)
  const destEmail = querEmail
    ? destTodos.filter((d) => d.email && String(d.email).trim())
    : []
  const whatsappDisponivel = whatsappEstaConfigurado()
  const destZap = querZap
    ? destTodos.filter((d) => digitosWhatsApp(d.celular))
    : []

  const statusEnvio = {
    aviso_id: aviso.id,
    criado_em: new Date().toISOString(),
    atualizado_em: new Date().toISOString(),
    situacao: querEmail || querZap ? 'processando' : 'sem_envio',
    email: {
      solicitado: querEmail,
      total: destEmail.length,
      enviados: 0,
      falhas: 0,
      pendentes: destEmail.length
    },
    whatsapp: {
      solicitado: querZap,
      provider_configurado: whatsappDisponivel,
      total: destZap.length,
      sem_celular: Math.max(0, destTodos.length - destZap.length),
      manuais_adicionados: 0,
      enviados: 0,
      falhas: 0,
      pendentes: whatsappDisponivel ? destZap.length : 0,
      nao_enviados_provider: whatsappDisponivel ? 0 : destZap.length
    }
  }
  envioStatusPorAviso.set(aviso.id, statusEnvio)

  setImmediate(() => {
    const jobs = []
    if (destEmail.length) {
      jobs.push(
        Promise.all(
          destEmail.map((d) =>
            withTimeout(
              enviarComunicadoAviso({
                para: d.email,
                nomeDestinatario: d.nome,
                titulo: tituloLinha,
                corpo: corpoTxt,
                departamentoNome: deptNome
              }),
              30000
            )
              .then((r) => !!(r && r.enviado))
              .catch(() => false)
          )
        ).then((results) => {
          statusEnvio.email.enviados = results.filter(Boolean).length
          statusEnvio.email.falhas = results.length - statusEnvio.email.enviados
          statusEnvio.email.pendentes = 0
          atualizarSituacaoGeral(statusEnvio)
        })
      )
    }
    if (destZap.length && whatsappDisponivel) {
      jobs.push(
        Promise.all(
          destZap.map((d) =>
            withTimeout(
              enviarComunicadoWhatsApp({
                celular: d.celular,
                nomeDestinatario: d.nome,
                titulo: tituloLinha,
                corpo: corpoTxt,
                departamentoNome: deptNome
              }),
              45000
            )
              .then((r) => !!(r && r.enviado))
              .catch(() => false)
          )
        ).then((results) => {
          statusEnvio.whatsapp.enviados = results.filter(Boolean).length
          statusEnvio.whatsapp.falhas = results.length - statusEnvio.whatsapp.enviados
          statusEnvio.whatsapp.pendentes = 0
          atualizarSituacaoGeral(statusEnvio)
        })
      )
    }
    Promise.all(jobs)
      .then(() => atualizarSituacaoGeral(statusEnvio))
      .catch(() => atualizarSituacaoGeral(statusEnvio))
  })

  eventBus.emit('notificacao_equipe', {
    tipo: 'comunicado',
    mensagem: tituloLinha ? `Comunicado reenviado: ${tituloLinha}` : 'Comunicado reenviado',
    destinatarios_email: destEmail.length,
    destinatarios_whatsapp: destZap.length
  })

  res.json({ ok: true, aviso_id: aviso.id, envio_status: clonarStatusEnvio(statusEnvio) })
})

// DELETE /aviso/:id — admin pode excluir qualquer; líder só do seu depto (ou próprio aviso)
router.delete('/:id', autenticar, (req, res) => {
  const aviso = sql.get(`SELECT * FROM avisos WHERE id = ?`, req.params.id)
  if (!aviso) return res.status(404).json({ erro: 'Comunicado não encontrado' })

  const uid = req.usuario.id
  const role = req.usuario.role

  if (role !== 'admin' && !podeGerirAviso(req.usuario, aviso)) {
    return res.status(403).json({ erro: 'Só pode excluir comunicados próprios ou do seu departamento' })
  }

  sql.run(`DELETE FROM avisos WHERE id = ?`, req.params.id)
  res.json({ ok: true })
})

module.exports = router
