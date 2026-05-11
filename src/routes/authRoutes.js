const express = require('express')
const bcrypt = require('bcryptjs')
const crypto = require('crypto')
const { v4: uuid } = require('uuid')
const db = require('../db/database')
const { syncTudoParaMemoria } = require('../db/bootstrap')
const { gerarToken, autenticar } = require('../auth/middleware')
const { enviarBoasVindas } = require('../services/mail')
const { enviarTextoWhatsApp, whatsappEstaConfigurado } = require('../services/whatsapp')

const router = express.Router()

function departamentosPayload(usuarioId) {
  return db
    .all(
      `
    SELECT d.*, ud.role_depto, ud.acesso_departamentos
    FROM usuario_departamento ud
    JOIN departamentos d ON d.id = ud.departamento_id
    WHERE ud.usuario_id = ?
  `,
      usuarioId
    )
    .map((d) => ({
      ...d,
      ativo: !!d.ativo,
      acesso_departamentos: JSON.parse(d.acesso_departamentos || '[]')
    }))
}

function usuarioPublico(row) {
  if (!row) return null
  const { senha, ...rest } = row
  // Enriquece com nome da congregação
  const cong = rest.congregacao_id
    ? db.get('SELECT id, nome, tipo FROM congregacoes WHERE id = ?', rest.congregacao_id)
    : null
  return {
    ...rest,
    ativo: !!rest.ativo,
    precisa_trocar_senha: !!rest.precisa_trocar_senha,
    acesso_financeiro: !!rest.acesso_financeiro,
    acesso_relatorio_financeiro: !!rest.acesso_relatorio_financeiro,
    acesso_financeiro_global: !!rest.acesso_financeiro_global,
    acesso_escala_global: !!rest.acesso_escala_global,
    acesso_cultos: !!rest.acesso_cultos,
    acesso_escalas: !!rest.acesso_escalas,
    acesso_comunicacoes: !!rest.acesso_comunicacoes,
    perfil_id: rest.perfil_id || null,
    congregacao: cong || null
  }
}

function montarTextoConviteWhatsApp({ nome, email, senhaTemporaria, mensagemExtra }) {
  const url = process.env.APP_PUBLIC_URL || `http://localhost:${process.env.PORT || 3000}`
  const extra = String(mensagemExtra || '').trim()
  return `Olá, ${nome}!

Você foi convidado(a) para a equipe no Peniel Mídia.

Login: ${email}
Senha provisória: ${senhaTemporaria}

Ao entrar, troque a senha no primeiro acesso.
${extra ? `\nMensagem da liderança:\n${extra}\n` : ''}
Acesse: ${url}

_ Peniel Mídia_`
}

/**
 * POST /auth/cadastro — voluntário (perfil membro). Líderes e admins entram por convite.
 * Opcional: departamento_id para já vincular à equipe escolhida (departamento ativo).
 */
router.post('/cadastro', async (req, res) => {
  const { nome, email, senha, celular, departamento_id } = req.body
  if (!nome || !email || !senha)
    return res.status(400).json({ erro: 'nome, email e senha são obrigatórios' })
  if (String(senha).length < 6)
    return res.status(400).json({ erro: 'A senha deve ter pelo menos 6 caracteres' })

  let deptoId = departamento_id ? String(departamento_id).trim() : ''
  if (deptoId) {
    const d = db.get(`SELECT id FROM departamentos WHERE id = ? AND ativo = 1`, deptoId)
    if (!d) return res.status(400).json({ erro: 'Departamento inválido ou inativo' })
  } else {
    deptoId = ''
  }

  const hash = await bcrypt.hash(senha, 10)
  const id = uuid()
  const agora = new Date().toISOString()

  db.run(
    `INSERT INTO usuarios (id, nome, email, celular, senha, role, ativo, criado_em, precisa_trocar_senha) VALUES (?,?,?,?,?,?,1,?,0)`,
    id,
    nome,
    email,
    celular || '',
    hash,
    'membro',
    agora
  )

  if (deptoId) {
    const vid = uuid()
    db.run(
      `INSERT INTO usuario_departamento (id, usuario_id, departamento_id, role_depto, acesso_departamentos) VALUES (?,?,?,?,?)`,
      vid,
      id,
      deptoId,
      'membro',
      '[]'
    )
  }

  syncTudoParaMemoria()

  const usuarioRow = db.get('SELECT * FROM usuarios WHERE id = ?', id)
  const departamentos = departamentosPayload(id)
  res.status(201).json({
    usuario: usuarioPublico(usuarioRow),
    token: gerarToken(usuarioRow),
    departamentos
  })
})

/**
 * POST /auth/convidar — liderança cria usuário com senha provisória, vínculo ao departamento e e-mail.
 * Body: { nome, email, departamento_id, perfil_convite?, role_depto? (legado), enviar_email?, mensagem_convite? }
 *
 * perfil_convite:
 * - voluntario → role global membro + role_depto membro (só visualiza, mensagens, solicita trocas)
 * - lider → role global lider + role_depto lider (cadastros/escalas deste e outros deptos conforme regras)
 * - admin → só quem convida é admin; role global admin + role_depto membro no departamento escolhido
 */
router.post('/convidar', autenticar, async (req, res) => {
  const {
    nome,
    email,
    celular,
    departamento_id,
    role_depto,
    perfil_convite,
    enviar_email,
    enviar_whatsapp,
    mensagem_convite,
    acesso_financeiro,
    congregacao_id
  } = req.body

  const apenasFinanceiro = !departamento_id && !!acesso_financeiro
  if (!nome || !email)
    return res.status(400).json({ erro: 'nome e email são obrigatórios' })
  if (!apenasFinanceiro && !departamento_id)
    return res.status(400).json({ erro: 'departamento_id é obrigatório para membros da equipe' })

  // Apenas admin pode criar obreiros financeiros sem departamento
  if (apenasFinanceiro && req.usuario.role !== 'admin')
    return res.status(403).json({ erro: 'Apenas admin pode cadastrar obreiros financeiros' })

  let depto = null
  if (departamento_id) {
    depto = db.get('SELECT id FROM departamentos WHERE id = ? AND ativo = 1', departamento_id)
    if (!depto) return res.status(404).json({ erro: 'Departamento não encontrado' })
  }

  if (!apenasFinanceiro && req.usuario.role !== 'admin') {
    if (req.usuario.role !== 'lider') {
      return res.status(403).json({ erro: 'Acesso restrito a administradores e líderes' })
    }
    const liderDoDepto = db.get(
      `SELECT 1 FROM usuario_departamento WHERE usuario_id = ? AND departamento_id = ? AND role_depto = 'lider'`,
      req.usuario.id,
      departamento_id
    )
    if (!liderDoDepto) {
      return res.status(403).json({ erro: 'Líder só pode convidar para o próprio departamento' })
    }
  }

  const perfisValidos = ['voluntario', 'lider', 'admin']
  let perfil = typeof perfil_convite === 'string' ? perfil_convite.trim().toLowerCase() : ''
  if (!perfil || !perfisValidos.includes(perfil)) {
    perfil = role_depto === 'lider' ? 'lider' : 'voluntario'
  }

  if (perfil === 'admin' && req.usuario.role !== 'admin') {
    return res.status(403).json({ erro: 'Apenas administrador pode convidar com perfil Administrador global.' })
  }

  let globalRole = 'membro'
  let roleDeptoFinal = 'membro'
  if (perfil === 'admin') {
    globalRole = 'admin'
    roleDeptoFinal = 'membro'
  } else if (perfil === 'lider') {
    globalRole = 'lider'
    roleDeptoFinal = 'lider'
  } else {
    globalRole = 'membro'
    roleDeptoFinal = 'membro'
  }

  const senhaTemp = crypto.randomBytes(9).toString('base64url') + 'a1'
  const hash = await bcrypt.hash(senhaTemp, 10)
  const id = uuid()
  const agora = new Date().toISOString()

  // Resolve congregação: usa a fornecida, ou a do admin que convida, ou a sede
  const sede = db.get(`SELECT id FROM congregacoes WHERE tipo = 'sede' LIMIT 1`)
  const congId = congregacao_id || req.usuario.congregacao_id || sede?.id || null

  db.run(
    `INSERT INTO usuarios (id, nome, email, celular, senha, role, ativo, criado_em, precisa_trocar_senha, acesso_financeiro, congregacao_id) VALUES (?,?,?,?,?,?,1,?,1,?,?)`,
    id,
    nome,
    email,
    celular || '',
    hash,
    globalRole,
    agora,
    apenasFinanceiro ? 1 : 0,
    congId
  )

  if (departamento_id) {
    const vid = uuid()
    db.run(
      `INSERT INTO usuario_departamento (id, usuario_id, departamento_id, role_depto, acesso_departamentos) VALUES (?,?,?,?,?)`,
      vid,
      id,
      departamento_id,
      roleDeptoFinal,
      '[]'
    )
  }

  syncTudoParaMemoria()

  let emailInfo = { enviado: false }
  if (enviar_email !== false) {
    try {
      emailInfo = await enviarBoasVindas({
        para: email,
        nome,
        senhaTemporaria: senhaTemp,
        mensagemExtra: mensagem_convite
      })
    } catch (e) {
      console.error('[auth/convidar] e-mail:', e.message)
      emailInfo = { enviado: false, erro: 'falha_envio' }
    }
  }

  const querWhatsapp =
    enviar_whatsapp === true ||
    enviar_whatsapp === 1 ||
    String(enviar_whatsapp || '').toLowerCase() === 'true'
  let whatsappInfo = { enviado: false }
  if (querWhatsapp) {
    if (!celular || !String(celular).trim()) {
      whatsappInfo = { enviado: false, motivo: 'sem_celular' }
    } else if (!whatsappEstaConfigurado()) {
      whatsappInfo = { enviado: false, motivo: 'whatsapp_desligado' }
    } else {
      const texto = montarTextoConviteWhatsApp({
        nome,
        email,
        senhaTemporaria: senhaTemp,
        mensagemExtra: mensagem_convite
      })
      try {
        whatsappInfo = await enviarTextoWhatsApp({ celular, texto })
      } catch (e) {
        console.error('[auth/convidar] whatsapp:', e.message)
        whatsappInfo = { enviado: false, erro: 'falha_envio' }
      }
    }
  }

  const usuarioRow = db.get('SELECT * FROM usuarios WHERE id = ?', id)
  res.status(201).json({
    usuario: usuarioPublico(usuarioRow),
    email: emailInfo,
    whatsapp: whatsappInfo,
    // só para ambiente sem SMTP — administrador pode repassar a senha com segurança
    senha_provisoria: emailInfo.enviado || whatsappInfo.enviado ? undefined : senhaTemp
  })
})

// POST /auth/trocar-senha-obrigatoria — primeiro acesso
router.post('/trocar-senha-obrigatoria', autenticar, async (req, res) => {
  const { senha_nova, senha_confirmacao } = req.body
  if (!senha_nova || senha_nova.length < 6)
    return res.status(400).json({ erro: 'A nova senha deve ter pelo menos 6 caracteres' })
  if (senha_nova !== senha_confirmacao)
    return res.status(400).json({ erro: 'As senhas não coincidem' })

  const u = db.get('SELECT * FROM usuarios WHERE id = ?', req.usuario.id)
  if (!u) return res.status(404).json({ erro: 'Usuário não encontrado' })
  if (!u.precisa_trocar_senha)
    return res.status(400).json({ erro: 'Não há troca de senha obrigatória para esta conta' })

  const hash = await bcrypt.hash(senha_nova, 10)
  db.run(`UPDATE usuarios SET senha = ?, precisa_trocar_senha = 0 WHERE id = ?`, hash, req.usuario.id)
  syncTudoParaMemoria()

  const atual = db.get('SELECT * FROM usuarios WHERE id = ?', req.usuario.id)
  res.json({ ok: true, usuario: usuarioPublico(atual) })
})

// POST /auth/login
router.post('/login', async (req, res) => {
  const { email, login, senha, usuario_id } = req.body
  const identificador = String(login || email || '').trim()
  if (!identificador || !senha)
    return res.status(400).json({ erro: 'login (e-mail ou nome) e senha são obrigatórios' })

  const candidatosAtivos = db.all(
    `SELECT * FROM usuarios WHERE ativo = 1 AND (email = ? OR lower(nome) = lower(?))`,
    identificador,
    identificador
  )
  if (!candidatosAtivos.length) return res.status(401).json({ erro: 'Credenciais inválidas' })

  if (candidatosAtivos.length > 1 && !usuario_id) {
    return res.status(409).json({
      erro: 'Mais de um cadastro encontrado. Escolha qual conta deseja acessar.',
      codigo: 'ESCOLHER_USUARIO',
      candidatos: candidatosAtivos.map((u) => ({
        id: u.id,
        nome: u.nome,
        email: u.email,
        celular: u.celular || ''
      }))
    })
  }

  const candidatos = usuario_id
    ? candidatosAtivos.filter((u) => u.id === usuario_id)
    : candidatosAtivos

  const matches = []
  for (const u of candidatos) {
    if (await bcrypt.compare(senha, u.senha)) matches.push(u)
  }
  if (!matches.length) return res.status(401).json({ erro: 'Credenciais inválidas' })

  const usuario = matches[0]

  res.json({
    usuario: usuarioPublico(usuario),
    token: gerarToken(usuario),
    departamentos: departamentosPayload(usuario.id)
  })
})

// GET /auth/me
router.get('/me', autenticar, (req, res) => {
  const usuario = db.get('SELECT * FROM usuarios WHERE id = ?', req.usuario.id)
  if (!usuario) return res.status(404).json({ erro: 'Usuário não encontrado' })

  res.json({ usuario: usuarioPublico(usuario), departamentos: departamentosPayload(usuario.id) })
})

module.exports = router
