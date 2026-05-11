const express = require('express')
const router = express.Router()
const { v4: uuid } = require('uuid')
const sql = require('../db/database')
const { syncDepartamentosParaMemoria, syncEscalasParaMemoria } = require('../db/bootstrap')
const { buscarEscalasComVoluntarios } = require('../services/escalasDb')
const { autenticar, apenasAdminOuLider, verificarAcessoDepartamento } = require('../auth/middleware')

function podeGerirDepartamento(req, departamentoId) {
  if (req.usuario.role === 'admin') return true
  const v = sql.get(
    `SELECT role_depto FROM usuario_departamento WHERE usuario_id = ? AND departamento_id = ?`,
    req.usuario.id,
    departamentoId
  )
  return v?.role_depto === 'lider'
}

// POST /departamento/criar — admin/líder
router.post('/criar', autenticar, apenasAdminOuLider, (req, res) => {
  const { nome, descricao, icone, cor } = req.body
  if (!nome) return res.status(400).json({ erro: 'Nome é obrigatório' })

  const id = uuid()
  const agora = new Date().toISOString()
  const perfilMidia = sql.get(`SELECT id FROM perfis WHERE nome = 'Mídia'`)
  sql.run(
    `INSERT INTO departamentos (id, nome, descricao, icone, cor, mensagem_pastoral, ativo, criado_em, perfil_id) VALUES (?,?,?,?,?,?,1,?,?)`,
    id,
    nome,
    descricao || '',
    icone || '📁',
    cor || '#D4161B',
    '',
    agora,
    perfilMidia?.id || null
  )
  syncDepartamentosParaMemoria()
  const dep = sql.get('SELECT * FROM departamentos WHERE id = ?', id)
  res.status(201).json({
    ...dep,
    ativo: !!dep.ativo
  })
})

// GET /departamento/cadastro-publico — só id/nome/ícone dos departamentos ativos (auto-cadastro de voluntário)
router.get('/cadastro-publico', (_req, res) => {
  const rows = sql.all(`SELECT id, nome, icone FROM departamentos WHERE ativo = 1 ORDER BY lower(nome)`)
  res.json(rows)
})

// GET /departamento/listar — filtrado por acesso do usuário
router.get('/listar', autenticar, (req, res) => {
  const mapLista = (rows) =>
    rows.map((dep) => ({
      ...dep,
      ativo: !!dep.ativo,
      total_membros: sql.get(
        `SELECT COUNT(*) as n FROM usuario_departamento WHERE departamento_id = ?`,
        dep.id
      ).n,
      lider: (() => {
        const v = sql.get(
          `SELECT ud.* FROM usuario_departamento ud
           WHERE ud.departamento_id = ? AND ud.role_depto = 'lider' LIMIT 1`,
          dep.id
        )
        if (!v) return null
        const u = sql.get('SELECT id, nome, avatar FROM usuarios WHERE id = ?', v.usuario_id)
        return u || null
      })()
    }))

  if (req.usuario.role === 'admin' || req.usuario.role === 'lider' || req.usuario.acesso_escala_global) {
    const todos = req.query.todos === '1'
    const rows = todos
      ? sql.all(
          `SELECT d.*, p.nome AS perfil_nome FROM departamentos d
           LEFT JOIN perfis p ON p.id = d.perfil_id
           ORDER BY d.ativo DESC, d.nome`
        )
      : sql.all(
          `SELECT d.*, p.nome AS perfil_nome FROM departamentos d
           LEFT JOIN perfis p ON p.id = d.perfil_id
           WHERE d.ativo = 1 ORDER BY d.nome`
        )
    return res.json(mapLista(rows))
  }

  const vinculos = sql.all(
    `SELECT * FROM usuario_departamento WHERE usuario_id = ?`,
    req.usuario.id
  )
  if (!vinculos.length) return res.json([])

  const permitidosSet = new Set()
  for (const v of vinculos) {
    permitidosSet.add(v.departamento_id)
    const acesso = JSON.parse(v.acesso_departamentos || '[]')
    for (const a of acesso) permitidosSet.add(a)
  }
  const permitidos = Array.from(permitidosSet)
  const rows = sql
    .all(
      `SELECT d.*, p.nome AS perfil_nome FROM departamentos d
       LEFT JOIN perfis p ON p.id = d.perfil_id
       WHERE d.ativo = 1 ORDER BY d.nome`
    )
    .filter((d) => permitidos.includes(d.id))

  const lista = rows.map((dep) => ({
    ...dep,
    ativo: !!dep.ativo,
    total_membros: sql.get(
      `SELECT COUNT(*) as n FROM usuario_departamento WHERE departamento_id = ?`,
      dep.id
    ).n,
    meu_papel:
      sql.get(
        `SELECT role_depto FROM usuario_departamento WHERE usuario_id = ? AND departamento_id = ?`,
        req.usuario.id,
        dep.id
      )?.role_depto || 'visitante'
  }))

  res.json(lista)
})

// GET /departamento/:id — detalhes + membros
router.get('/:id', autenticar, verificarAcessoDepartamento, (req, res) => {
  const dep = sql.get(
    `SELECT d.*, p.nome AS perfil_nome FROM departamentos d
     LEFT JOIN perfis p ON p.id = d.perfil_id WHERE d.id = ?`,
    req.params.id
  )
  if (!dep) return res.status(404).json({ erro: 'Departamento não encontrado' })

  const vinculos = sql.all(
    `SELECT * FROM usuario_departamento WHERE departamento_id = ?`,
    dep.id
  )
  const membros = vinculos
    .map((v) => {
      const u = sql.get(`SELECT id, nome, email, role, ativo, avatar, criado_em FROM usuarios WHERE id = ?`, v.usuario_id)
      if (!u) return null
      return { ...u, ativo: !!u.ativo, role_depto: v.role_depto }
    })
    .filter(Boolean)

  const escalas = buscarEscalasComVoluntarios()
    .filter((e) => e.departamento_id === dep.id)
    .slice(0, 8)

  res.json({
    ...dep,
    ativo: !!dep.ativo,
    membros,
    escalas_recentes: escalas
  })
})

// PUT /departamento/:id — admin/líder
router.put('/:id', autenticar, apenasAdminOuLider, (req, res) => {
  const dep = sql.get('SELECT * FROM departamentos WHERE id = ?', req.params.id)
  if (!dep) return res.status(404).json({ erro: 'Departamento não encontrado' })
  if (!podeGerirDepartamento(req, req.params.id)) {
    return res.status(403).json({ erro: 'Sem permissão para alterar este departamento' })
  }

  const { nome, descricao, icone, cor, ativo, mensagem_pastoral, perfil_id } = req.body
  if (nome !== undefined) sql.run(`UPDATE departamentos SET nome = ? WHERE id = ?`, nome, req.params.id)
  if (descricao !== undefined)
    sql.run(`UPDATE departamentos SET descricao = ? WHERE id = ?`, descricao, req.params.id)
  if (icone !== undefined) sql.run(`UPDATE departamentos SET icone = ? WHERE id = ?`, icone, req.params.id)
  if (cor !== undefined) sql.run(`UPDATE departamentos SET cor = ? WHERE id = ?`, cor, req.params.id)
  if (mensagem_pastoral !== undefined)
    sql.run(`UPDATE departamentos SET mensagem_pastoral = ? WHERE id = ?`, String(mensagem_pastoral), req.params.id)
  if (ativo !== undefined) sql.run(`UPDATE departamentos SET ativo = ? WHERE id = ?`, ativo ? 1 : 0, req.params.id)
  if (perfil_id !== undefined && req.usuario.role === 'admin') {
    if (perfil_id === null || perfil_id === '')
      sql.run(`UPDATE departamentos SET perfil_id = NULL WHERE id = ?`, req.params.id)
    else if (sql.get(`SELECT id FROM perfis WHERE id = ?`, perfil_id))
      sql.run(`UPDATE departamentos SET perfil_id = ? WHERE id = ?`, perfil_id, req.params.id)
  }

  syncDepartamentosParaMemoria()
  const atualizado = sql.get(
    `SELECT d.*, p.nome AS perfil_nome FROM departamentos d
     LEFT JOIN perfis p ON p.id = d.perfil_id WHERE d.id = ?`,
    req.params.id
  )
  res.json({ ...atualizado, ativo: !!atualizado.ativo })
})

// DELETE /departamento/:id — admin/líder (exclusão total)
router.delete('/:id', autenticar, apenasAdminOuLider, (req, res) => {
  const dep = sql.get('SELECT * FROM departamentos WHERE id = ?', req.params.id)
  if (!dep) return res.status(404).json({ erro: 'Departamento não encontrado' })
  if (!podeGerirDepartamento(req, req.params.id)) {
    return res.status(403).json({ erro: 'Sem permissão para excluir este departamento' })
  }

  const excluirDepartamento = sql.transaction((deptoId) => {
    // Escalas deste departamento precisam sair antes (FK em escalas.departamento_id).
    sql.run(`DELETE FROM escalas WHERE departamento_id = ?`, deptoId)
    sql.run(`DELETE FROM usuario_departamento WHERE departamento_id = ?`, deptoId)
    sql.run(`DELETE FROM departamentos WHERE id = ?`, deptoId)
  })
  excluirDepartamento(req.params.id)

  syncDepartamentosParaMemoria()
  syncEscalasParaMemoria()
  res.json({ ok: true, mensagem: `Departamento "${dep.nome}" excluído` })
})

module.exports = router
