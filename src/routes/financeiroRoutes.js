const express = require('express')
const router  = express.Router()
const { v4: uuid } = require('uuid')
const db = require('../db/database')
const { autenticar, apenasAdmin, apenasAdminFinanceiro, apenasFinanceiro, apenasRelatorioFinanceiro } = require('../auth/middleware')

// ── helpers ─────────────────────────────────────────────────────────────────
function hoje() {
  const d = new Date()
  return `${String(d.getDate()).padStart(2,'0')}/${String(d.getMonth()+1).padStart(2,'0')}/${d.getFullYear()}`
}
function isoHoje() {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`
}
function ddmmToISO(s) {
  if (!s) return ''
  const p = String(s).split('/')
  if (p.length === 3) return `${p[2]}-${p[1]}-${p[0]}`
  return s
}
function resumo(rows) {
  const entradas = rows.filter(r => r.tipo === 'entrada').reduce((s, r) => s + r.valor, 0)
  const saidas   = rows.filter(r => r.tipo === 'saida').reduce((s, r) => s + r.valor, 0)
  return { entradas, saidas, saldo: entradas - saidas }
}

// ── CATEGORIAS ───────────────────────────────────────────────────────────────

// GET /financeiro/categorias
router.get('/categorias', autenticar, apenasFinanceiro, (req, res) => {
  const rows = db.all('SELECT * FROM categorias_financeiro ORDER BY tipo, nome')
  res.json(rows)
})

// POST /financeiro/categorias
router.post('/categorias', autenticar, apenasAdminFinanceiro, (req, res) => {
  const { nome, tipo } = req.body
  if (!nome || !['entrada','saida'].includes(tipo))
    return res.status(400).json({ erro: 'nome e tipo (entrada|saida) obrigatórios' })
  const id = uuid()
  db.run('INSERT INTO categorias_financeiro (id,nome,tipo,ativo,criado_em) VALUES (?,?,?,1,?)',
    id, nome.trim(), tipo, new Date().toISOString())
  res.status(201).json(db.get('SELECT * FROM categorias_financeiro WHERE id=?', id))
})

// PUT /financeiro/categorias/:id
router.put('/categorias/:id', autenticar, apenasAdminFinanceiro, (req, res) => {
  const { nome, tipo, ativo } = req.body
  const cat = db.get('SELECT id FROM categorias_financeiro WHERE id=?', req.params.id)
  if (!cat) return res.status(404).json({ erro: 'Categoria não encontrada' })
  if (nome) db.run('UPDATE categorias_financeiro SET nome=? WHERE id=?', nome.trim(), req.params.id)
  if (tipo && ['entrada','saida'].includes(tipo))
    db.run('UPDATE categorias_financeiro SET tipo=? WHERE id=?', tipo, req.params.id)
  if (ativo !== undefined)
    db.run('UPDATE categorias_financeiro SET ativo=? WHERE id=?', ativo ? 1 : 0, req.params.id)
  res.json(db.get('SELECT * FROM categorias_financeiro WHERE id=?', req.params.id))
})

// DELETE /financeiro/categorias/:id
router.delete('/categorias/:id', autenticar, apenasAdminFinanceiro, (req, res) => {
  const uso = db.get('SELECT id FROM lancamentos_financeiro WHERE categoria_id=? LIMIT 1', req.params.id)
  if (uso) return res.status(400).json({ erro: 'Categoria em uso, não pode ser excluída. Desative-a.' })
  db.run('DELETE FROM categorias_financeiro WHERE id=?', req.params.id)
  res.json({ ok: true })
})

// ── LANÇAMENTOS ──────────────────────────────────────────────────────────────

// GET /financeiro/lancamentos?data=DD/MM/YYYY | mes=YYYY-MM | data_inicio=YYYY-MM-DD&data_fim=YYYY-MM-DD
router.get('/lancamentos', autenticar, apenasFinanceiro, (req, res) => {
  const { data, mes, data_inicio, data_fim } = req.query
  let where = []
  let params = []

  if (data_inicio && data_fim) {
    // Converte DD/MM/YYYY armazenado para ISO para comparar
    where.push(`substr(l.data,7,4)||'-'||substr(l.data,4,2)||'-'||substr(l.data,1,2) BETWEEN ? AND ?`)
    params.push(data_inicio, data_fim)
  } else if (data) {
    where.push('l.data = ?')
    params.push(data)
  } else if (mes) {
    const [y, m] = mes.split('-')
    where.push(`substr(l.data,7,4) = ? AND substr(l.data,4,2) = ?`)
    params.push(y, m)
  }

  if (req.usuario.role !== 'admin' && !req.usuario.acesso_financeiro) {
    return res.status(403).json({ erro: 'Sem permissão' })
  }

  const isGlobal = req.usuario.role === 'admin' || req.usuario.acesso_financeiro_global
  if (!isGlobal && req.usuario.congregacao_id) {
    // Usuário sem acesso global só vê a própria congregação
    where.push('l.congregacao_id = ?')
    params.push(req.usuario.congregacao_id)
  } else if (isGlobal && req.query.congregacao_id) {
    // Acesso global pode filtrar por congregação específica
    where.push('l.congregacao_id = ?')
    params.push(req.query.congregacao_id)
  }

  const sql = `
    SELECT l.*, c.nome as categoria_nome, c.tipo as categoria_tipo,
           u.nome as lancado_por_nome,
           COALESCE(ev2.nome, e.nome) as evento_nome,
           es.data as escala_data, d.nome as escala_depto,
           cg.nome as congregacao_nome
    FROM lancamentos_financeiro l
    JOIN categorias_financeiro c ON c.id = l.categoria_id
    JOIN usuarios u ON u.id = l.lancado_por
    LEFT JOIN eventos e  ON e.id  = l.evento_id
    LEFT JOIN escalas es ON es.id = l.escala_id
    LEFT JOIN eventos ev2 ON ev2.id = es.evento_id
    LEFT JOIN departamentos d ON d.id = es.departamento_id
    LEFT JOIN congregacoes cg ON cg.id = l.congregacao_id
    ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
    ORDER BY l.data DESC, l.criado_em DESC
  `
  res.json(db.all(sql, ...params))
})

// POST /financeiro/lancamentos
router.post('/lancamentos', autenticar, apenasFinanceiro, (req, res) => {
  const { data, escala_id, evento_id, categoria_id, valor, descricao, tipo } = req.body
  if (!data || !categoria_id || !valor || !tipo)
    return res.status(400).json({ erro: 'data, categoria_id, valor e tipo são obrigatórios' })
  if (!['entrada','saida'].includes(tipo))
    return res.status(400).json({ erro: 'tipo deve ser entrada ou saida' })
  if (tipo === 'saida' && req.usuario.role !== 'admin')
    return res.status(403).json({ erro: 'Apenas admin pode lançar saídas' })

  const cat = db.get('SELECT id FROM categorias_financeiro WHERE id=? AND ativo=1', categoria_id)
  if (!cat) return res.status(400).json({ erro: 'Categoria inválida ou inativa' })

  // Deriva evento_id da escala se não fornecido diretamente
  let eventoFinal = evento_id || null
  if (escala_id && !eventoFinal) {
    const esc = db.get('SELECT evento_id FROM escalas WHERE id=?', escala_id)
    if (esc) eventoFinal = esc.evento_id
  }

  const id = uuid()
  const agora = new Date().toISOString()
  const congId = req.usuario.congregacao_id || null
  db.run(`INSERT INTO lancamentos_financeiro
    (id,data,escala_id,evento_id,categoria_id,valor,descricao,tipo,lancado_por,validado,criado_em,congregacao_id)
    VALUES (?,?,?,?,?,?,?,?,?,0,?,?)`,
    id, data, escala_id || null, eventoFinal, categoria_id, Number(valor), descricao || '', tipo, req.usuario.id, agora, congId)

  res.status(201).json(db.get(`
    SELECT l.*, c.nome as categoria_nome, u.nome as lancado_por_nome,
           COALESCE(ev2.nome, e.nome) as evento_nome
    FROM lancamentos_financeiro l
    JOIN categorias_financeiro c ON c.id=l.categoria_id
    JOIN usuarios u ON u.id=l.lancado_por
    LEFT JOIN eventos e   ON e.id   = l.evento_id
    LEFT JOIN escalas es  ON es.id  = l.escala_id
    LEFT JOIN eventos ev2 ON ev2.id = es.evento_id
    WHERE l.id=?`, id))
})

// PUT /financeiro/lancamentos/:id
router.put('/lancamentos/:id', autenticar, apenasFinanceiro, (req, res) => {
  const lanc = db.get('SELECT * FROM lancamentos_financeiro WHERE id=?', req.params.id)
  if (!lanc) return res.status(404).json({ erro: 'Lançamento não encontrado' })
  const ehAdminFin = req.usuario.role === 'admin' || req.usuario.acesso_financeiro_saida
  if (lanc.validado && !ehAdminFin)
    return res.status(403).json({ erro: 'Lançamento conferido só pode ser alterado pelo administrador financeiro' })
  if (lanc.lancado_por !== req.usuario.id && !ehAdminFin)
    return res.status(403).json({ erro: 'Sem permissão para editar este lançamento' })

  const { valor, descricao, categoria_id, escala_id, evento_id, data } = req.body
  if (valor !== undefined) db.run('UPDATE lancamentos_financeiro SET valor=? WHERE id=?', Number(valor), req.params.id)
  if (descricao !== undefined) db.run('UPDATE lancamentos_financeiro SET descricao=? WHERE id=?', descricao, req.params.id)
  if (categoria_id) db.run('UPDATE lancamentos_financeiro SET categoria_id=? WHERE id=?', categoria_id, req.params.id)
  if (data) db.run('UPDATE lancamentos_financeiro SET data=? WHERE id=?', data, req.params.id)
  if (escala_id !== undefined) {
    db.run('UPDATE lancamentos_financeiro SET escala_id=? WHERE id=?', escala_id || null, req.params.id)
    if (escala_id && !evento_id) {
      const esc = db.get('SELECT evento_id FROM escalas WHERE id=?', escala_id)
      if (esc?.evento_id) db.run('UPDATE lancamentos_financeiro SET evento_id=? WHERE id=?', esc.evento_id, req.params.id)
    }
  } else if (evento_id !== undefined) {
    db.run('UPDATE lancamentos_financeiro SET evento_id=? WHERE id=?', evento_id || null, req.params.id)
  }

  res.json(db.get(`
    SELECT l.*, c.nome as categoria_nome, u.nome as lancado_por_nome,
           COALESCE(ev2.nome, e.nome) as evento_nome
    FROM lancamentos_financeiro l
    JOIN categorias_financeiro c ON c.id=l.categoria_id
    JOIN usuarios u ON u.id=l.lancado_por
    LEFT JOIN eventos e   ON e.id   = l.evento_id
    LEFT JOIN escalas es  ON es.id  = l.escala_id
    LEFT JOIN eventos ev2 ON ev2.id = es.evento_id
    WHERE l.id=?`, req.params.id))
})

// DELETE /financeiro/lancamentos/:id
router.delete('/lancamentos/:id', autenticar, apenasFinanceiro, (req, res) => {
  const lanc = db.get('SELECT * FROM lancamentos_financeiro WHERE id=?', req.params.id)
  if (!lanc) return res.status(404).json({ erro: 'Lançamento não encontrado' })
  const ehAdminFin = req.usuario.role === 'admin' || req.usuario.acesso_financeiro_saida
  if (lanc.validado && !ehAdminFin)
    return res.status(403).json({ erro: 'Lançamento conferido só pode ser excluído pelo administrador financeiro' })
  if (lanc.lancado_por !== req.usuario.id && !ehAdminFin)
    return res.status(403).json({ erro: 'Sem permissão para excluir este lançamento' })
  db.run('DELETE FROM lancamentos_financeiro WHERE id=?', req.params.id)
  res.json({ ok: true })
})

// POST /financeiro/lancamentos/:id/validar
router.post('/lancamentos/:id/validar', autenticar, apenasAdminFinanceiro, (req, res) => {
  const lanc = db.get('SELECT id FROM lancamentos_financeiro WHERE id=?', req.params.id)
  if (!lanc) return res.status(404).json({ erro: 'Lançamento não encontrado' })
  db.run('UPDATE lancamentos_financeiro SET validado=1, validado_por=?, validado_em=? WHERE id=?',
    req.usuario.id, new Date().toISOString(), req.params.id)
  res.json({ ok: true })
})

// POST /financeiro/lancamentos/:id/desvalidar (admin pode reverter)
router.post('/lancamentos/:id/desvalidar', autenticar, apenasAdminFinanceiro, (req, res) => {
  db.run('UPDATE lancamentos_financeiro SET validado=0, validado_por=NULL, validado_em=NULL WHERE id=?', req.params.id)
  res.json({ ok: true })
})

// ── DASHBOARD ────────────────────────────────────────────────────────────────

// GET /financeiro/dashboard?data=DD/MM/YYYY
router.get('/dashboard', autenticar, apenasFinanceiro, apenasRelatorioFinanceiro, (req, res) => {
  const data = req.query.data || hoje()

  const _isGlobalDash = req.usuario.role === 'admin' || req.usuario.acesso_financeiro_global
  const congId = _isGlobalDash
    ? (req.query.congregacao_id || null)
    : (req.usuario.congregacao_id || null)
  const congFilter = congId ? 'AND l.congregacao_id = ?' : ''
  const congParam  = congId ? [congId] : []

  const lancamentos = db.all(`
    SELECT l.*, c.nome as categoria_nome, c.tipo as categoria_tipo,
           u.nome as lancado_por_nome,
           COALESCE(ev2.nome, e.nome) as evento_nome,
           es.data as escala_data, d.nome as escala_depto,
           cg.nome as congregacao_nome
    FROM lancamentos_financeiro l
    JOIN categorias_financeiro c ON c.id = l.categoria_id
    JOIN usuarios u ON u.id = l.lancado_por
    LEFT JOIN eventos e   ON e.id   = l.evento_id
    LEFT JOIN escalas es  ON es.id  = l.escala_id
    LEFT JOIN eventos ev2 ON ev2.id = es.evento_id
    LEFT JOIN departamentos d ON d.id = es.departamento_id
    LEFT JOIN congregacoes cg ON cg.id = l.congregacao_id
    WHERE l.data = ? ${congFilter}
    ORDER BY l.criado_em
  `, data, ...congParam)

  // Agrupa por escala_id (quando disponível) ou evento_id
  const porEvento = {}
  for (const l of lancamentos) {
    const chave = l.escala_id || l.evento_id || '__sem_evento__'
    if (!porEvento[chave]) porEvento[chave] = { evento_id: l.evento_id, escala_id: l.escala_id, evento_nome: l.evento_nome || 'Sem evento', items: [] }
    porEvento[chave].items.push(l)
  }

  const grupos = Object.values(porEvento).map(g => ({
    ...g,
    ...resumo(g.items)
  }))

  res.json({
    data,
    grupos,
    totais: resumo(lancamentos),
    total_lancamentos: lancamentos.length
  })
})

// ── RELATÓRIO MENSAL ─────────────────────────────────────────────────────────

// GET /financeiro/relatorio?mes=YYYY-MM | data_inicio=YYYY-MM-DD&data_fim=YYYY-MM-DD
router.get('/relatorio', autenticar, apenasFinanceiro, apenasRelatorioFinanceiro, (req, res) => {
  const { data_inicio, data_fim } = req.query
  const mes = req.query.mes || isoHoje().slice(0, 7)
  const [y, m] = mes.split('-')

  const _isGlobalRel = req.usuario.role === 'admin' || req.usuario.acesso_financeiro_global
  const relCongId = _isGlobalRel
    ? (req.query.congregacao_id || null)
    : (req.usuario.congregacao_id || null)
  const relCongFilter = relCongId ? 'AND l.congregacao_id = ?' : ''
  const relCongParam  = relCongId ? [relCongId] : []

  let periodoFilter, periodoParams
  if (data_inicio && data_fim) {
    periodoFilter = `substr(l.data,7,4)||'-'||substr(l.data,4,2)||'-'||substr(l.data,1,2) BETWEEN ? AND ?`
    periodoParams = [data_inicio, data_fim]
  } else {
    periodoFilter = `substr(l.data,7,4) = ? AND substr(l.data,4,2) = ?`
    periodoParams = [y, m]
  }

  const lancamentos = db.all(`
    SELECT l.*, c.nome as categoria_nome, c.tipo as categoria_tipo,
           u.nome as lancado_por_nome,
           COALESCE(ev2.nome, e.nome) as evento_nome,
           d.nome as escala_depto,
           cg.nome as congregacao_nome
    FROM lancamentos_financeiro l
    JOIN categorias_financeiro c ON c.id = l.categoria_id
    JOIN usuarios u ON u.id = l.lancado_por
    LEFT JOIN eventos e   ON e.id   = l.evento_id
    LEFT JOIN escalas es  ON es.id  = l.escala_id
    LEFT JOIN eventos ev2 ON ev2.id = es.evento_id
    LEFT JOIN departamentos d ON d.id = es.departamento_id
    LEFT JOIN congregacoes cg ON cg.id = l.congregacao_id
    WHERE ${periodoFilter} ${relCongFilter}
    ORDER BY l.data, l.criado_em
  `, ...periodoParams, ...relCongParam)

  // Por categoria
  const porCategoria = {}
  for (const l of lancamentos) {
    if (!porCategoria[l.categoria_id]) {
      porCategoria[l.categoria_id] = { nome: l.categoria_nome, tipo: l.categoria_tipo, total: 0 }
    }
    porCategoria[l.categoria_id].total += l.valor
  }

  // Por data (para gráfico)
  const porData = {}
  for (const l of lancamentos) {
    if (!porData[l.data]) porData[l.data] = { entradas: 0, saidas: 0 }
    if (l.tipo === 'entrada') porData[l.data].entradas += l.valor
    else porData[l.data].saidas += l.valor
  }

  res.json({
    mes,
    lancamentos,
    por_categoria: Object.values(porCategoria).sort((a, b) => b.total - a.total),
    por_data: Object.entries(porData)
      .map(([data, v]) => ({ data, ...v }))
      .sort((a, b) => ddmmToISO(a.data).localeCompare(ddmmToISO(b.data))),
    totais: resumo(lancamentos)
  })
})

// GET /financeiro/me — retorna se o usuário logado tem acesso financeiro
router.get('/me', autenticar, (req, res) => {
  res.json({
    acesso_financeiro: req.usuario.role === 'admin' || req.usuario.acesso_financeiro,
    role: req.usuario.role
  })
})

module.exports = router
