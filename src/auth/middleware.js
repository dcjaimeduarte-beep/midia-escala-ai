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
      'SELECT id, nome, email, role, acesso_financeiro, acesso_financeiro_global, acesso_relatorio_financeiro, congregacao_id FROM usuarios WHERE id = ? AND ativo = 1',
      payload.id
    )
    if (!row) return res.status(401).json({ erro: 'Usuário inválido ou inativo' })
    req.usuario = {
      id: row.id,
      nome: row.nome,
      email: row.email,
      role: row.role,
      acesso_financeiro: !!row.acesso_financeiro,
      acesso_financeiro_global: !!row.acesso_financeiro_global,
      acesso_relatorio_financeiro: !!row.acesso_relatorio_financeiro,
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
  if (req.usuario.role === 'admin' || req.usuario.role === 'lider') return next()

  const deptoId = req.body?.departamento_id || req.params?.departamento_id || req.query?.departamento_id

  const vinculos = db.all('SELECT * FROM usuario_departamento WHERE usuario_id = ?', req.usuario.id)
  if (!vinculos.length) return res.status(403).json({ erro: 'Você não pertence a nenhum departamento' })

  const permitidos = new Set()
  for (const v of vinculos) {
    permitidos.add(v.departamento_id)
    const extra = JSON.parse(v.acesso_departamentos || '[]')
    extra.forEach((id) => permitidos.add(id))
  }

  if (deptoId && !permitidos.has(deptoId))
    return res.status(403).json({ erro: 'Sem acesso a este departamento' })

  const principal = (deptoId ? vinculos.find((v) => v.departamento_id === deptoId) : null) || vinculos[0]
  req.vinculo = { ...principal, acesso_departamentos: JSON.parse(principal.acesso_departamentos || '[]') }
  next()
}

function apenasFinanceiro(req, res, next) {
  if (req.usuario.role === 'admin' || req.usuario.acesso_financeiro) return next()
  return res.status(403).json({ erro: 'Sem acesso ao módulo financeiro' })
}

function apenasRelatorioFinanceiro(req, res, next) {
  if (req.usuario.role === 'admin' || req.usuario.role === 'lider' || req.usuario.acesso_relatorio_financeiro) return next()
  return res.status(403).json({ erro: 'Sem permissão para acessar relatórios financeiros' })
}

module.exports = {
  gerarToken,
  autenticar,
  apenasAdmin,
  apenasAdminOuLider,
  apenasFinanceiro,
  apenasRelatorioFinanceiro,
  verificarRole,
  verificarAcessoDepartamento
}
