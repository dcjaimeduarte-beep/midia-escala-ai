const express = require('express')
const router = express.Router()
const { v4: uuid } = require('uuid')
const sql = require('../db/database')
const { autenticar, apenasAdmin } = require('../auth/middleware')

const FLAGS = ['acesso_financeiro','acesso_relatorio_financeiro','acesso_financeiro_global','acesso_escala_global','acesso_cultos','acesso_escalas','acesso_comunicacoes']

function mapPerfil(p) {
  return {
    ...p,
    acesso_financeiro: !!p.acesso_financeiro,
    acesso_relatorio_financeiro: !!p.acesso_relatorio_financeiro,
    acesso_financeiro_global: !!p.acesso_financeiro_global,
    acesso_escala_global: !!p.acesso_escala_global,
    acesso_cultos: !!p.acesso_cultos,
    acesso_escalas: !!p.acesso_escalas,
    acesso_comunicacoes: !!p.acesso_comunicacoes,
  }
}

router.get('/listar', autenticar, (req, res) => {
  res.json(sql.all(`SELECT * FROM perfis ORDER BY nome`).map(mapPerfil))
})

router.post('/criar', autenticar, apenasAdmin, (req, res) => {
  const { nome, acesso_financeiro, acesso_relatorio_financeiro, acesso_financeiro_global, acesso_escala_global, acesso_cultos, acesso_escalas, acesso_comunicacoes } = req.body
  if (!nome?.trim()) return res.status(400).json({ erro: 'Nome é obrigatório' })
  const id = uuid()
  sql.run(
    `INSERT INTO perfis (id,nome,acesso_financeiro,acesso_relatorio_financeiro,acesso_financeiro_global,acesso_escala_global,acesso_cultos,acesso_escalas,acesso_comunicacoes,criado_em) VALUES (?,?,?,?,?,?,?,?,?,?)`,
    id, nome.trim(),
    acesso_financeiro ? 1 : 0,
    acesso_relatorio_financeiro ? 1 : 0,
    acesso_financeiro_global ? 1 : 0,
    acesso_escala_global ? 1 : 0,
    acesso_cultos ? 1 : 0,
    acesso_escalas ? 1 : 0,
    acesso_comunicacoes ? 1 : 0,
    new Date().toISOString()
  )
  res.status(201).json(mapPerfil(sql.get(`SELECT * FROM perfis WHERE id = ?`, id)))
})

router.put('/:id', autenticar, apenasAdmin, (req, res) => {
  const perfil = sql.get(`SELECT * FROM perfis WHERE id = ?`, req.params.id)
  if (!perfil) return res.status(404).json({ erro: 'Perfil não encontrado' })
  const { nome, ...flags } = req.body
  if (nome) sql.run(`UPDATE perfis SET nome = ? WHERE id = ?`, nome.trim(), req.params.id)
  for (const f of FLAGS) {
    if (flags[f] !== undefined) sql.run(`UPDATE perfis SET ${f} = ? WHERE id = ?`, flags[f] ? 1 : 0, req.params.id)
  }
  const p = sql.get(`SELECT * FROM perfis WHERE id = ?`, req.params.id)
  // Propaga flags atualizadas para todos os usuários vinculados a este perfil
  sql.run(
    `UPDATE usuarios SET acesso_financeiro=?,acesso_relatorio_financeiro=?,acesso_financeiro_global=?,acesso_escala_global=?,acesso_cultos=?,acesso_escalas=?,acesso_comunicacoes=? WHERE perfil_id=?`,
    p.acesso_financeiro, p.acesso_relatorio_financeiro, p.acesso_financeiro_global, p.acesso_escala_global, p.acesso_cultos, p.acesso_escalas, p.acesso_comunicacoes, req.params.id
  )
  res.json(mapPerfil(p))
})

router.delete('/:id', autenticar, apenasAdmin, (req, res) => {
  if (!sql.get(`SELECT id FROM perfis WHERE id = ?`, req.params.id))
    return res.status(404).json({ erro: 'Perfil não encontrado' })
  sql.run(`UPDATE usuarios SET perfil_id = NULL WHERE perfil_id = ?`, req.params.id)
  sql.run(`DELETE FROM perfis WHERE id = ?`, req.params.id)
  res.json({ ok: true })
})

module.exports = router
