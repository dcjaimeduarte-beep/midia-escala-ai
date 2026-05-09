const express = require('express')
const router = express.Router()
const bcrypt = require('bcryptjs')
const { v4: uuid } = require('uuid')
const sql = require('../db/database')
const { syncTudoParaMemoria } = require('../db/bootstrap')
const { autenticar, apenasAdmin } = require('../auth/middleware')

function departamentosOndeELider(usuarioId) {
  return sql
    .all(
      `SELECT departamento_id FROM usuario_departamento WHERE usuario_id = ? AND role_depto = 'lider'`,
      usuarioId
    )
    .map((r) => r.departamento_id)
}

function alguemCompartilhaDepartamento(usuarioAlvoId, departamentoIds) {
  if (!departamentoIds.length) return false
  const ph = departamentoIds.map(() => '?').join(',')
  return !!sql.get(
    `SELECT 1 FROM usuario_departamento WHERE usuario_id = ? AND departamento_id IN (${ph}) LIMIT 1`,
    usuarioAlvoId,
    ...departamentoIds
  )
}

function departamentosDoUsuario(usuarioId) {
  return sql
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

// GET /usuario/listar — admin vê todos; líder vê só o seu departamento
router.get('/listar', autenticar, (req, res) => {
  if (req.usuario.role === 'admin') {
    const usuarios = sql.all(
      `SELECT u.id, u.nome, u.email, u.celular, u.role, u.ativo, u.avatar, u.criado_em,
              u.precisa_trocar_senha, u.acesso_financeiro, u.acesso_relatorio_financeiro, u.congregacao_id,
              c.nome as congregacao_nome, c.tipo as congregacao_tipo
       FROM usuarios u
       LEFT JOIN congregacoes c ON c.id = u.congregacao_id
       ORDER BY u.nome`
    )
    const lista = usuarios.map((u) => ({
      ...u,
      ativo: !!u.ativo,
      precisa_trocar_senha: !!u.precisa_trocar_senha,
      acesso_financeiro: !!u.acesso_financeiro,
      acesso_relatorio_financeiro: !!u.acesso_relatorio_financeiro,
      congregacao: u.congregacao_id ? { id: u.congregacao_id, nome: u.congregacao_nome, tipo: u.congregacao_tipo } : null,
      departamentos: departamentosDoUsuario(u.id).map((d) => ({
        id: d.id,
        nome: d.nome,
        icone: d.icone,
        cor: d.cor,
        role_depto: d.role_depto
      }))
    }))
    return res.json(lista)
  }

  const vinculos = sql.all(
    `SELECT departamento_id FROM usuario_departamento WHERE usuario_id = ?`,
    req.usuario.id
  )
  if (!vinculos.length) return res.json([])

  const deptIds = [...new Set(vinculos.map((v) => v.departamento_id).filter(Boolean))]
  if (!deptIds.length) return res.json([])

  const ph = deptIds.map(() => '?').join(',')
  const membrosIds = [
    ...new Set(
      sql
        .all(
          `SELECT DISTINCT usuario_id FROM usuario_departamento WHERE departamento_id IN (${ph})`,
          ...deptIds
        )
        .map((r) => r.usuario_id)
    )
  ]

  if (!membrosIds.length) return res.json([])

  const lista = sql
    .all(
      `SELECT id, nome, email, celular, role, ativo, avatar, criado_em FROM usuarios WHERE id IN (${membrosIds.map(() => '?').join(',')})`,
      ...membrosIds
    )
    .map((u) => ({ ...u, ativo: !!u.ativo }))

  res.json(lista)
})

// GET /usuario/listar-publico — lista básica para seleção em trocas
router.get('/listar-publico', autenticar, (_req, res) => {
  const lista = sql
    .all(
      `SELECT id, nome, email, celular FROM usuarios WHERE ativo = 1 ORDER BY nome`
    )
    .map((u) => ({ ...u, celular: u.celular || '' }))
  res.json(lista)
})

// GET /usuario/:id
router.get('/:id', autenticar, (req, res) => {
  const usuario = sql.get(`SELECT * FROM usuarios WHERE id = ?`, req.params.id)
  if (!usuario) return res.status(404).json({ erro: 'Usuário não encontrado' })

  const departamentos = departamentosDoUsuario(usuario.id).map((d) => ({
    ...d,
    acesso_departamentos: d.acesso_departamentos
  }))

  const { senha, ...semSenha } = usuario
  res.json({
    ...semSenha,
    ativo: !!semSenha.ativo,
    precisa_trocar_senha: !!semSenha.precisa_trocar_senha,
    departamentos
  })
})

// PUT /usuario/:id — admin; líder global; ou líder de departamento que partilha equipa com o alvo
router.put('/:id', autenticar, async (req, res) => {
  const usuario = sql.get(`SELECT * FROM usuarios WHERE id = ?`, req.params.id)
  if (!usuario) return res.status(404).json({ erro: 'Usuário não encontrado' })

  const admin = req.usuario.role === 'admin'
  const liderGlobal = req.usuario.role === 'lider'
  let podeEditar = admin || liderGlobal
  if (!podeEditar) {
    const depsLider = departamentosOndeELider(req.usuario.id)
    podeEditar = alguemCompartilhaDepartamento(req.params.id, depsLider)
  }
  if (!podeEditar)
    return res.status(403).json({ erro: 'Sem permissão para alterar cadastros' })

  const { nome, email, celular, data_nascimento, senha, ativo, avatar, role, acesso_financeiro, acesso_relatorio_financeiro, acesso_financeiro_global, acesso_escala_global, congregacao_id } = req.body

  if (role !== undefined) {
    if (req.usuario.role !== 'admin')
      return res.status(403).json({ erro: 'Apenas administradores podem alterar o perfil global' })
    const permitidos = ['admin', 'lider', 'membro']
    if (!permitidos.includes(role)) return res.status(400).json({ erro: 'Perfil inválido' })
    if (usuario.role === 'admin' && role !== 'admin') {
      const { n } = sql.get(`SELECT COUNT(*) as n FROM usuarios WHERE role = 'admin'`)
      if (n <= 1) return res.status(400).json({ erro: 'Deve existir pelo menos um administrador' })
    }
    sql.run(`UPDATE usuarios SET role = ? WHERE id = ?`, role, req.params.id)
  }

  if (nome) sql.run(`UPDATE usuarios SET nome = ? WHERE id = ?`, nome, req.params.id)
  if (email) sql.run(`UPDATE usuarios SET email = ? WHERE id = ?`, email, req.params.id)
  if (celular !== undefined) sql.run(`UPDATE usuarios SET celular = ? WHERE id = ?`, celular, req.params.id)
  if (data_nascimento !== undefined) sql.run(`UPDATE usuarios SET data_nascimento = ? WHERE id = ?`, data_nascimento || '', req.params.id)
  if (avatar !== undefined) sql.run(`UPDATE usuarios SET avatar = ? WHERE id = ?`, avatar, req.params.id)
  if (ativo !== undefined && req.usuario.role === 'admin')
    sql.run(`UPDATE usuarios SET ativo = ? WHERE id = ?`, ativo ? 1 : 0, req.params.id)
  if (senha) {
    const hash = await bcrypt.hash(senha, 10)
    sql.run(`UPDATE usuarios SET senha = ? WHERE id = ?`, hash, req.params.id)
  }
  if (acesso_financeiro !== undefined && admin)
    sql.run(`UPDATE usuarios SET acesso_financeiro = ? WHERE id = ?`, acesso_financeiro ? 1 : 0, req.params.id)
  if (acesso_relatorio_financeiro !== undefined && admin)
    sql.run(`UPDATE usuarios SET acesso_relatorio_financeiro = ? WHERE id = ?`, acesso_relatorio_financeiro ? 1 : 0, req.params.id)
  if (acesso_financeiro_global !== undefined && admin)
    sql.run(`UPDATE usuarios SET acesso_financeiro_global = ? WHERE id = ?`, acesso_financeiro_global ? 1 : 0, req.params.id)
  if (acesso_escala_global !== undefined && admin)
    sql.run(`UPDATE usuarios SET acesso_escala_global = ? WHERE id = ?`, acesso_escala_global ? 1 : 0, req.params.id)
  if (congregacao_id !== undefined && admin)
    sql.run(`UPDATE usuarios SET congregacao_id = ? WHERE id = ?`, congregacao_id || null, req.params.id)

  syncTudoParaMemoria()
  const atual = sql.get(`SELECT id, nome, email, celular, role, ativo, avatar, criado_em, precisa_trocar_senha, acesso_financeiro, acesso_relatorio_financeiro, acesso_financeiro_global, acesso_escala_global FROM usuarios WHERE id = ?`, req.params.id)
  res.json({
    ...atual,
    ativo: !!atual.ativo,
    precisa_trocar_senha: !!atual.precisa_trocar_senha,
    acesso_financeiro: !!atual.acesso_financeiro,
    acesso_relatorio_financeiro: !!atual.acesso_relatorio_financeiro,
    acesso_financeiro_global: !!atual.acesso_financeiro_global,
    acesso_escala_global: !!atual.acesso_escala_global
  })
})

// DELETE /usuario/:id — admin (exclusão total do cadastro)
router.delete('/:id', autenticar, apenasAdmin, (req, res) => {
  const alvo = sql.get(`SELECT id, role FROM usuarios WHERE id = ?`, req.params.id)
  if (!alvo) return res.status(404).json({ erro: 'Usuário não encontrado' })

  if (alvo.role === 'admin') {
    const { n } = sql.get(`SELECT COUNT(*) as n FROM usuarios WHERE role = 'admin'`)
    if (n <= 1) return res.status(400).json({ erro: 'Deve existir pelo menos um administrador' })
  }

  try {
    const apagarUsuarioCompleto = sql.transaction((uid) => {
      // Limpa vínculos diretos e referências históricas antes de remover o cadastro.
      sql.run(`DELETE FROM usuario_departamento WHERE usuario_id = ?`, uid)
      sql.run(`DELETE FROM escala_voluntarios WHERE usuario_id = ?`, uid)
      sql.run(`DELETE FROM escala_trocas WHERE usuario_anterior_id = ? OR usuario_novo_id = ?`, uid, uid)
      sql.run(`UPDATE escala_trocas SET registrado_por = NULL WHERE registrado_por = ?`, uid)
      sql.run(`DELETE FROM troca_solicitacoes WHERE usuario_sai = ? OR usuario_entra = ?`, uid, uid)
      sql.run(`DELETE FROM troca_solicitacoes WHERE solicitante_id = ?`, uid)
      sql.run(`UPDATE troca_solicitacoes SET aprovado_por = NULL WHERE aprovado_por = ?`, uid)
      sql.run(`UPDATE escalas SET criado_por = NULL WHERE criado_por = ?`, uid)
      sql.run(`DELETE FROM avisos WHERE autor_id = ?`, uid)
      sql.run(`DELETE FROM usuarios WHERE id = ?`, uid)
    })
    apagarUsuarioCompleto(req.params.id)
  } catch (e) {
    return res.status(400).json({
      erro:
        'Não foi possível excluir totalmente este cadastro porque ele possui referências protegidas em registros antigos.'
    })
  }

  syncTudoParaMemoria()
  res.json({ ok: true })
})

// POST /usuario/vincular
router.post('/vincular', autenticar, (req, res) => {
  const { usuario_id, departamento_id, role_depto, acesso_departamentos } = req.body
  if (!usuario_id || !departamento_id)
    return res.status(400).json({ erro: 'usuario_id e departamento_id são obrigatórios' })

  const usuario = sql.get(`SELECT * FROM usuarios WHERE id = ?`, usuario_id)
  if (!usuario) return res.status(404).json({ erro: 'Usuário não encontrado' })

  const depto = sql.get(`SELECT * FROM departamentos WHERE id = ?`, departamento_id)
  if (!depto) return res.status(404).json({ erro: 'Departamento não encontrado' })

  if (req.usuario.role !== 'admin' && req.usuario.role !== 'lider') {
    const vinculoLider = sql.get(
      `SELECT * FROM usuario_departamento WHERE usuario_id = ? AND departamento_id = ? AND role_depto = 'lider'`,
      req.usuario.id,
      departamento_id
    )
    if (!vinculoLider) return res.status(403).json({ erro: 'Apenas o líder ou admin pode vincular membros' })
  }

  sql.run(`DELETE FROM usuario_departamento WHERE usuario_id = ? AND departamento_id = ?`, usuario_id, departamento_id)

  const vid = uuid()
  const acessoJson = JSON.stringify(acesso_departamentos || [])
  sql.run(
    `INSERT INTO usuario_departamento (id, usuario_id, departamento_id, role_depto, acesso_departamentos) VALUES (?,?,?,?,?)`,
    vid,
    usuario_id,
    departamento_id,
    role_depto || 'membro',
    acessoJson
  )

  syncTudoParaMemoria()

  const vinculo = sql.get(`SELECT * FROM usuario_departamento WHERE id = ?`, vid)
  const { senha: _, ...semSenha } = usuario
  res.status(201).json({
    ok: true,
    vinculo: {
      ...vinculo,
      acesso_departamentos: JSON.parse(vinculo.acesso_departamentos || '[]'),
      usuario: { ...semSenha, ativo: !!usuario.ativo },
      departamento: { ...depto, ativo: !!depto.ativo }
    }
  })
})

// PUT /usuario/:id/acesso — admin
router.put('/:id/acesso', autenticar, apenasAdmin, (req, res) => {
  const { departamento_id, acesso_departamentos } = req.body
  const vinculo = sql.get(
    `SELECT * FROM usuario_departamento WHERE usuario_id = ? AND departamento_id = ?`,
    req.params.id,
    departamento_id
  )
  if (!vinculo) return res.status(404).json({ erro: 'Vínculo não encontrado' })

  sql.run(
    `UPDATE usuario_departamento SET acesso_departamentos = ? WHERE id = ?`,
    JSON.stringify(acesso_departamentos || []),
    vinculo.id
  )
  syncTudoParaMemoria()
  const atual = sql.get(`SELECT * FROM usuario_departamento WHERE id = ?`, vinculo.id)
  res.json({
    ok: true,
    vinculo: {
      ...atual,
      acesso_departamentos: JSON.parse(atual.acesso_departamentos || '[]')
    }
  })
})

// DELETE /usuario/:id/desvincular — admin
router.delete('/:id/desvincular', autenticar, apenasAdmin, (req, res) => {
  const { departamento_id } = req.body
  const r = sql.run(
    `DELETE FROM usuario_departamento WHERE usuario_id = ? AND departamento_id = ?`,
    req.params.id,
    departamento_id
  )
  if (!r.changes) return res.status(404).json({ erro: 'Vínculo não encontrado' })
  syncTudoParaMemoria()
  res.json({ ok: true })
})

module.exports = router
