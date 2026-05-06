const bcrypt = require('bcryptjs')
const { v4: uuid } = require('uuid')
const db = require('./database')
const { initSchema, seedDepartamentos, migrate } = require('./schema')

/** Mantém `src/models/db.js` alinhado aos usuários do SQLite (rotas antigas ainda usam memória). */
function syncUsuariosParaMemoria() {
  const memoryDb = require('../models/db')
  const rows = db.all('SELECT * FROM usuarios')
  const idxPorId = new Map(memoryDb.usuarios.map((u, i) => [u.id, i]))

  for (const row of rows) {
    const u = {
      id: row.id,
      nome: row.nome,
      email: row.email,
      celular: row.celular || '',
      senha: row.senha,
      role: row.role,
      ativo: !!row.ativo,
      avatar: row.avatar || null,
      criado_em: row.criado_em,
      precisa_trocar_senha: !!row.precisa_trocar_senha
    }
    const i = idxPorId.get(row.id)
    if (i !== undefined) memoryDb.usuarios[i] = u
    else memoryDb.usuarios.push(u)
  }
}

function syncDepartamentosParaMemoria() {
  const memoryDb = require('../models/db')
  const rows = db.all('SELECT * FROM departamentos ORDER BY nome')
  memoryDb.departamentos = rows.map((r) => ({
    id: r.id,
    nome: r.nome,
    descricao: r.descricao || '',
    icone: r.icone || '📁',
    cor: r.cor || '#D4161B',
    ativo: !!r.ativo,
    criado_em: r.criado_em
  }))
}

function syncVinculosParaMemoria() {
  const memoryDb = require('../models/db')
  const rows = db.all('SELECT * FROM usuario_departamento')
  memoryDb.usuario_departamento = rows.map((r) => ({
    id: r.id,
    usuario_id: r.usuario_id,
    departamento_id: r.departamento_id,
    role_depto: r.role_depto,
    acesso_departamentos: JSON.parse(r.acesso_departamentos || '[]')
  }))
}

function syncEventosParaMemoria() {
  const memoryDb = require('../models/db')
  try {
    const rows = db.all('SELECT * FROM eventos ORDER BY nome')
    memoryDb.eventos = rows.map((r) => ({
      id: r.id,
      nome: r.nome,
      dia_semana: r.dia_semana,
      hora_inicio: r.hora_inicio || '',
      hora_fim: r.hora_fim || '',
      descricao: r.descricao || '',
      ativo: !!r.ativo,
      criado_em: r.criado_em
    }))
  } catch {
    memoryDb.eventos = []
  }
}

function syncEscalasParaMemoria() {
  const memoryDb = require('../models/db')
  const { buscarEscalasComVoluntarios } = require('../services/escalasDb')
  memoryDb.escalas = buscarEscalasComVoluntarios()
}

function syncTudoParaMemoria() {
  syncUsuariosParaMemoria()
  syncDepartamentosParaMemoria()
  syncVinculosParaMemoria()
  syncEventosParaMemoria()
  syncEscalasParaMemoria()
}

async function seedUsuarioPadrao() {
  const email = process.env.SEED_ADMIN_EMAIL || 'admin@peniel.com'
  const senha = process.env.SEED_ADMIN_SENHA || 'peniel123'
  const nome = process.env.SEED_ADMIN_NOME || 'Administrador'

  // Não duplica a conta seed se já existir administrador com este e-mail
  if (db.get(`SELECT id FROM usuarios WHERE email = ? AND role = 'admin'`, email)) return

  const hash = await bcrypt.hash(senha, 10)
  const id = uuid()
  const agora = new Date().toISOString()

  db.run(
    'INSERT INTO usuarios (id, nome, email, senha, role, ativo, criado_em, precisa_trocar_senha) VALUES (?,?,?,?,?,1,?,0)',
    id,
    nome,
    email,
    hash,
    'admin',
    agora
  )

  console.log(
    `✅ Usuário administrador padrão criado: ${email} (defina SEED_ADMIN_EMAIL / SEED_ADMIN_SENHA no .env em produção)`
  )
}

async function bootstrap() {
  initSchema()
  migrate()
  seedDepartamentos()
  await seedUsuarioPadrao()
  syncTudoParaMemoria()
}

module.exports = {
  bootstrap,
  seedUsuarioPadrao,
  syncUsuariosParaMemoria,
  syncDepartamentosParaMemoria,
  syncVinculosParaMemoria,
  syncEventosParaMemoria,
  syncEscalasParaMemoria,
  syncTudoParaMemoria
}
