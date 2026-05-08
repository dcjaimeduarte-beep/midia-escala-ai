const jwt = require('jsonwebtoken')
const db  = require('../db/database')

const SECRET = process.env.JWT_SECRET || 'peniel-secret'

function gerarToken(usuario) {
  return jwt.sign(
    { id: usuario.id, nome: usuario.nome, email: usuario.email, role: usuario.role },
    SECRET,
    { expiresIn: '7d' }
  )
}

function autenticar(req, res, next) {
  const auth = req.headers.authorization
  if (!auth?.startsWith('Bearer ')) return res.status(401).json({ erro: 'Token não fornecido' })
  try {
    const payload = jwt.verify(auth.split(' ')[1], SECRET)
    const row = db.get(
      'SELECT id, nome, email, role, acesso_financeiro, congregacao_id FROM usuarios WHERE id = ? AND ativo = 1',
      payload.id
    )
    if (!row) return res.status(401).json({ erro: 'Usuário inválido ou inativo' })
    req.usuario = {
      id: row.id,
      nome: row.nome,
      email: row.email,
      role: row.role,
      acesso_financeiro: !!row.acesso_financeiro,
      congregacao_id: row.congregacao_id || null
    }
    next()
  } catch {
    res.status(401).json({ erro: 'Token inválido ou expirado' })
  }
}

function apenasAdmin(req, res, next) {
  if (req.usuario.role !== 'admin') return res.status(403).json({ erro: 'Acesso restrito a administradores' })
  next()
}

function apenasAdminOuLider(req, res, next) {
  if (req.usuario.role !== 'admin' && req.usuario.role !== 'lider') {
    return res.status(403).json({ erro: 'Acesso restrito a administradores e líderes' })
  }
  next()
}

function verificarRole(...roles) {
  return (req, res, next) => {
    if (!roles.includes(req.usuario.role)) return res.status(403).json({ erro: 'Sem permissão' })
    next()
  }
}

function verificarAcessoDepartamento(req, res, next) {
  if (req.usuario.role === 'admin') return next()

  const deptoId = req.body?.departamento_id || req.params?.departamento_id || req.query?.departamento_id

  const vinculo = db.get('SELECT * FROM usuario_departamento WHERE usuario_id = ?', req.usuario.id)
  if (!vinculo) return res.status(403).json({ erro: 'Você não pertence a nenhum departamento' })

  const acesso = JSON.parse(vinculo.acesso_departamentos || '[]')
  const permitidos = [vinculo.departamento_id, ...acesso]

  if (deptoId && !permitidos.includes(deptoId))
    return res.status(403).json({ erro: 'Sem acesso a este departamento' })

  req.vinculo = { ...vinculo, acesso_departamentos: acesso }
  next()
}

function apenasFinanceiro(req, res, next) {
  if (req.usuario.role === 'admin' || req.usuario.acesso_financeiro) return next()
  return res.status(403).json({ erro: 'Sem acesso ao módulo financeiro' })
}

module.exports = {
  gerarToken,
  autenticar,
  apenasAdmin,
  apenasAdminOuLider,
  apenasFinanceiro,
  verificarRole,
  verificarAcessoDepartamento
}
