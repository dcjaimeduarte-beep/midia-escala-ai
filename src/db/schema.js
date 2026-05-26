const db  = require('./database')
const { v4: uuid } = require('uuid')

function initSchema() {
  db.exec(`
    -- ── USUÁRIOS ────────────────────────────────────────────
    CREATE TABLE IF NOT EXISTS usuarios (
      id         TEXT PRIMARY KEY,
      nome       TEXT NOT NULL,
      email      TEXT NOT NULL,
      celular    TEXT DEFAULT '',
      senha      TEXT NOT NULL,
      role       TEXT NOT NULL DEFAULT 'membro',
      ativo      INTEGER NOT NULL DEFAULT 1,
      avatar     TEXT,
      criado_em  TEXT NOT NULL
    );

    -- ── DEPARTAMENTOS ────────────────────────────────────────
    CREATE TABLE IF NOT EXISTS departamentos (
      id                 TEXT PRIMARY KEY,
      nome               TEXT NOT NULL,
      descricao          TEXT DEFAULT '',
      icone              TEXT DEFAULT '📁',
      cor                TEXT DEFAULT '#D4161B',
      mensagem_pastoral  TEXT NOT NULL DEFAULT '',
      ativo              INTEGER NOT NULL DEFAULT 1,
      criado_em          TEXT NOT NULL
    );

    -- ── VÍNCULO USUÁRIO ↔ DEPARTAMENTO ──────────────────────
    CREATE TABLE IF NOT EXISTS usuario_departamento (
      id                   TEXT PRIMARY KEY,
      usuario_id           TEXT NOT NULL REFERENCES usuarios(id) ON DELETE CASCADE,
      departamento_id      TEXT NOT NULL REFERENCES departamentos(id) ON DELETE CASCADE,
      role_depto           TEXT NOT NULL DEFAULT 'membro',
      acesso_departamentos TEXT NOT NULL DEFAULT '[]',
      UNIQUE(usuario_id, departamento_id)
    );

    -- ── ESCALAS ──────────────────────────────────────────────
    CREATE TABLE IF NOT EXISTS escalas (
      id              TEXT PRIMARY KEY,
      data            TEXT NOT NULL,
      departamento_id TEXT NOT NULL REFERENCES departamentos(id),
      observacao      TEXT DEFAULT '',
      criado_por      TEXT REFERENCES usuarios(id),
      criado_em       TEXT NOT NULL
    );

    -- ── VOLUNTÁRIOS NA ESCALA ────────────────────────────────
    CREATE TABLE IF NOT EXISTS escala_voluntarios (
      id         TEXT PRIMARY KEY,
      escala_id  TEXT NOT NULL REFERENCES escalas(id) ON DELETE CASCADE,
      usuario_id TEXT NOT NULL REFERENCES usuarios(id) ON DELETE CASCADE,
      funcao     TEXT DEFAULT '',
      UNIQUE(escala_id, usuario_id)
    );

    CREATE TABLE IF NOT EXISTS escala_trocas (
      id                   TEXT PRIMARY KEY,
      escala_id            TEXT NOT NULL REFERENCES escalas(id) ON DELETE CASCADE,
      usuario_anterior_id  TEXT NOT NULL REFERENCES usuarios(id),
      usuario_novo_id      TEXT NOT NULL REFERENCES usuarios(id),
      funcao_mantida       TEXT NOT NULL DEFAULT '',
      registrado_em        TEXT NOT NULL,
      registrado_por       TEXT REFERENCES usuarios(id),
      observacao           TEXT NOT NULL DEFAULT ''
    );
  `)
}

function seedDepartamentos() {
  const { n } = db.get('SELECT COUNT(*) as n FROM departamentos')
  if (n > 0) return

  const deptos = [
    { nome: 'Projeção',    descricao: 'Letras e slides',     icone: '📽️', cor: '#6C3483' },
    { nome: 'Ao Vivo',     descricao: 'Transmissão ao vivo', icone: '🔴', cor: '#C0392B' },
    { nome: 'Stories',     descricao: 'Redes sociais',       icone: '📱', cor: '#E67E22' },
    { nome: 'Iluminação',  descricao: 'Luz e efeitos',       icone: '💡', cor: '#D4AC0D' },
    { nome: 'Fotos',       descricao: 'Fotografia',          icone: '📷', cor: '#2980B9' },
    { nome: 'Engajamento', descricao: 'Interação e chat',    icone: '💬', cor: '#27AE60' },
  ]

  const agora = new Date().toISOString()
  for (const d of deptos) {
    db.run(
      'INSERT INTO departamentos (id, nome, descricao, icone, cor, mensagem_pastoral, ativo, criado_em) VALUES (?,?,?,?,?,?,1,?)',
      uuid(), d.nome, d.descricao, d.icone, d.cor, '', agora
    )
  }

  console.log('✅ Departamentos padrão criados')
}

/** Remove UNIQUE do e-mail em bancos criados com a restrição antiga (SQLite não permite DROP COLUMN). */
function migrateRemoverEmailUnique() {
  const row = db.get(`SELECT sql FROM sqlite_master WHERE type='table' AND name='usuarios'`)
  if (!row?.sql || !/\bemail\b[\s\w]*UNIQUE|UNIQUE[\s\w]*\bemail\b/i.test(row.sql)) return

  const raw = db._db
  raw.exec('BEGIN IMMEDIATE')
  try {
    raw.pragma('foreign_keys = OFF')
    db.exec(`
      CREATE TABLE usuarios__email_dup (
        id TEXT PRIMARY KEY,
        nome TEXT NOT NULL,
        email TEXT NOT NULL,
        celular TEXT DEFAULT '',
        senha TEXT NOT NULL,
        role TEXT NOT NULL DEFAULT 'membro',
        ativo INTEGER NOT NULL DEFAULT 1,
        avatar TEXT,
        criado_em TEXT NOT NULL,
        precisa_trocar_senha INTEGER NOT NULL DEFAULT 0
      );
      INSERT INTO usuarios__email_dup
        SELECT id, nome, email, COALESCE(celular, ''), senha, role, ativo, avatar, criado_em, COALESCE(precisa_trocar_senha, 0) FROM usuarios;
      DROP TABLE usuarios;
      ALTER TABLE usuarios__email_dup RENAME TO usuarios;
    `)
    raw.pragma('foreign_keys = ON')
    raw.exec('COMMIT')
  } catch (e) {
    try {
      raw.exec('ROLLBACK')
    } catch (_) {}
    throw e
  }
}

/** Ajustes em bancos já existentes + tabela de tipos de evento/culto */
function migrate() {
  const tryExec = (sql) => {
    try {
      db.exec(sql)
    } catch (_) {
      /* coluna/tabela já existe */
    }
  }

  tryExec(
    `ALTER TABLE usuarios ADD COLUMN precisa_trocar_senha INTEGER NOT NULL DEFAULT 0`
  )
  tryExec(`ALTER TABLE usuarios ADD COLUMN celular TEXT DEFAULT ''`)
  tryExec(`ALTER TABLE departamentos ADD COLUMN mensagem_pastoral TEXT NOT NULL DEFAULT ''`)
  tryExec(`ALTER TABLE avisos ADD COLUMN data_inicio TEXT NOT NULL DEFAULT ''`)
  tryExec(`ALTER TABLE avisos ADD COLUMN hora_inicio TEXT NOT NULL DEFAULT ''`)
  tryExec(`ALTER TABLE avisos ADD COLUMN data_fim TEXT NOT NULL DEFAULT ''`)
  tryExec(`ALTER TABLE avisos ADD COLUMN hora_fim TEXT NOT NULL DEFAULT ''`)

  migrateRemoverEmailUnique()

  db.exec(`
    CREATE TABLE IF NOT EXISTS eventos (
      id          TEXT PRIMARY KEY,
      nome        TEXT NOT NULL,
      dia_semana  INTEGER,
      hora_inicio TEXT NOT NULL DEFAULT '',
      hora_fim    TEXT NOT NULL DEFAULT '',
      descricao   TEXT NOT NULL DEFAULT '',
      ativo       INTEGER NOT NULL DEFAULT 1,
      criado_em   TEXT NOT NULL
    );
  `)

  tryExec(`ALTER TABLE escalas ADD COLUMN evento_id TEXT`)
  tryExec(`ALTER TABLE usuarios ADD COLUMN acesso_financeiro INTEGER NOT NULL DEFAULT 0`)

  db.exec(`
    CREATE TABLE IF NOT EXISTS categorias_financeiro (
      id        TEXT PRIMARY KEY,
      nome      TEXT NOT NULL,
      tipo      TEXT NOT NULL CHECK(tipo IN ('entrada','saida')),
      ativo     INTEGER NOT NULL DEFAULT 1,
      criado_em TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS lancamentos_financeiro (
      id           TEXT PRIMARY KEY,
      data         TEXT NOT NULL,
      evento_id    TEXT REFERENCES eventos(id) ON DELETE SET NULL,
      categoria_id TEXT NOT NULL REFERENCES categorias_financeiro(id),
      valor        REAL NOT NULL,
      descricao    TEXT DEFAULT '',
      tipo         TEXT NOT NULL CHECK(tipo IN ('entrada','saida')),
      lancado_por  TEXT NOT NULL REFERENCES usuarios(id),
      validado     INTEGER NOT NULL DEFAULT 0,
      validado_por TEXT REFERENCES usuarios(id),
      validado_em  TEXT,
      criado_em    TEXT NOT NULL
    );
  `)

  const { n: nCat } = db.get('SELECT COUNT(*) as n FROM categorias_financeiro') || { n: 0 }
  if (!nCat) {
    const agora = new Date().toISOString()
    const cats = [
      { nome: 'Dízimo',           tipo: 'entrada' },
      { nome: 'Oferta',           tipo: 'entrada' },
      { nome: 'Primícia',         tipo: 'entrada' },
      { nome: 'Oferta Especial',  tipo: 'entrada' },
      { nome: 'Despesa Geral',    tipo: 'saida'   },
      { nome: 'Aluguel',          tipo: 'saida'   },
      { nome: 'Utilidades',       tipo: 'saida'   },
      { nome: 'Transporte',       tipo: 'saida'   },
      { nome: 'Material',         tipo: 'saida'   },
    ]
    const { v4: uuidv4 } = require('uuid')
    for (const c of cats) {
      db.run('INSERT INTO categorias_financeiro (id,nome,tipo,ativo,criado_em) VALUES (?,?,?,1,?)', uuidv4(), c.nome, c.tipo, agora)
    }
  }

  tryExec(`ALTER TABLE lancamentos_financeiro ADD COLUMN escala_id TEXT REFERENCES escalas(id) ON DELETE SET NULL`)

  db.exec(`
    CREATE TABLE IF NOT EXISTS escala_trocas (
      id                   TEXT PRIMARY KEY,
      escala_id            TEXT NOT NULL REFERENCES escalas(id) ON DELETE CASCADE,
      usuario_anterior_id  TEXT NOT NULL REFERENCES usuarios(id),
      usuario_novo_id      TEXT NOT NULL REFERENCES usuarios(id),
      funcao_mantida       TEXT NOT NULL DEFAULT '',
      registrado_em        TEXT NOT NULL,
      registrado_por       TEXT REFERENCES usuarios(id),
      observacao           TEXT NOT NULL DEFAULT ''
    );
  `)

  db.exec(`
    CREATE TABLE IF NOT EXISTS troca_solicitacoes (
      id                 TEXT PRIMARY KEY,
      escala_id          TEXT NOT NULL REFERENCES escalas(id) ON DELETE CASCADE,
      departamento_id    TEXT NOT NULL REFERENCES departamentos(id) ON DELETE CASCADE,
      usuario_sai        TEXT NOT NULL REFERENCES usuarios(id),
      usuario_entra      TEXT NOT NULL REFERENCES usuarios(id),
      solicitante_id     TEXT NOT NULL REFERENCES usuarios(id),
      observacao         TEXT NOT NULL DEFAULT '',
      status             TEXT NOT NULL DEFAULT 'pendente',
      aprovado_por       TEXT REFERENCES usuarios(id),
      resolvido_em       TEXT,
      criado_em          TEXT NOT NULL
    );
  `)

  db.exec(`
    CREATE TABLE IF NOT EXISTS avisos (
      id               TEXT PRIMARY KEY,
      titulo           TEXT NOT NULL DEFAULT '',
      corpo            TEXT NOT NULL,
      departamento_id  TEXT REFERENCES departamentos(id) ON DELETE SET NULL,
      autor_id         TEXT REFERENCES usuarios(id) ON DELETE SET NULL,
      criado_em        TEXT NOT NULL,
      data_inicio      TEXT NOT NULL DEFAULT '',
      hora_inicio      TEXT NOT NULL DEFAULT '',
      data_fim         TEXT NOT NULL DEFAULT '',
      hora_fim         TEXT NOT NULL DEFAULT ''
    );
  `)

  // ── CONGREGAÇÕES ─────────────────────────────────────────────────────────────
  db.exec(`
    CREATE TABLE IF NOT EXISTS congregacoes (
      id        TEXT PRIMARY KEY,
      nome      TEXT NOT NULL,
      tipo      TEXT NOT NULL DEFAULT 'subcongregacao' CHECK(tipo IN ('sede','subcongregacao')),
      cidade    TEXT NOT NULL DEFAULT '',
      endereco  TEXT NOT NULL DEFAULT '',
      ativo     INTEGER NOT NULL DEFAULT 1,
      criado_em TEXT NOT NULL
    );
  `)

  tryExec(`ALTER TABLE usuarios    ADD COLUMN congregacao_id TEXT REFERENCES congregacoes(id) ON DELETE SET NULL`)
  tryExec(`ALTER TABLE escalas     ADD COLUMN congregacao_id TEXT REFERENCES congregacoes(id) ON DELETE SET NULL`)
  tryExec(`ALTER TABLE lancamentos_financeiro ADD COLUMN congregacao_id TEXT REFERENCES congregacoes(id) ON DELETE SET NULL`)
  tryExec(`ALTER TABLE usuarios    ADD COLUMN acesso_financeiro_global INTEGER NOT NULL DEFAULT 0`)
  tryExec(`ALTER TABLE usuarios    ADD COLUMN acesso_relatorio_financeiro INTEGER NOT NULL DEFAULT 0`)
  tryExec(`ALTER TABLE usuarios    ADD COLUMN data_nascimento TEXT DEFAULT ''`)
  tryExec(`ALTER TABLE usuarios    ADD COLUMN acesso_escala_global INTEGER NOT NULL DEFAULT 0`)

  // ── CULTOS (sessões de culto com check-in por QR Code) ───────────────────────
  db.exec(`
    CREATE TABLE IF NOT EXISTS cultos (
      id             TEXT PRIMARY KEY,
      titulo         TEXT NOT NULL DEFAULT '',
      evento_id      TEXT REFERENCES eventos(id) ON DELETE SET NULL,
      congregacao_id TEXT REFERENCES congregacoes(id) ON DELETE SET NULL,
      data           TEXT NOT NULL,
      descricao      TEXT NOT NULL DEFAULT '',
      encerrado      INTEGER NOT NULL DEFAULT 0,
      criado_por     TEXT NOT NULL REFERENCES usuarios(id),
      criado_em      TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS presencas (
      id            TEXT PRIMARY KEY,
      culto_id      TEXT NOT NULL REFERENCES cultos(id) ON DELETE CASCADE,
      tipo          TEXT NOT NULL CHECK(tipo IN ('membro','visitante','visitante_convidado')),
      nome          TEXT NOT NULL,
      convidado_por TEXT NOT NULL DEFAULT '',
      usuario_id    TEXT REFERENCES usuarios(id) ON DELETE SET NULL,
      registrado_em TEXT NOT NULL
    );
  `)

  tryExec(`ALTER TABLE presencas ADD COLUMN celular TEXT NOT NULL DEFAULT ''`)
  tryExec(`ALTER TABLE presencas ADD COLUMN bairro  TEXT NOT NULL DEFAULT ''`)
  tryExec(`ALTER TABLE presencas ADD COLUMN igreja  TEXT NOT NULL DEFAULT ''`)
  tryExec(`ALTER TABLE usuarios  ADD COLUMN acesso_cultos INTEGER NOT NULL DEFAULT 0`)
  tryExec(`ALTER TABLE usuarios  ADD COLUMN bloqueado INTEGER NOT NULL DEFAULT 0`)

  // Garante departamento Obreiros (financeiro + introdução / check-in)
  const { n: nObreiros } = db.get(`SELECT COUNT(*) as n FROM departamentos WHERE nome = 'Obreiros'`) || { n: 0 }
  if (!nObreiros) {
    const { v4: uuidv4 } = require('uuid')
    db.run(
      `INSERT INTO departamentos (id, nome, descricao, icone, cor, mensagem_pastoral, ativo, criado_em) VALUES (?,?,?,?,?,?,1,?)`,
      uuidv4(), 'Obreiros', 'Financeiro e Introdução', '🙏', '#1A5276', '', new Date().toISOString()
    )
    console.log('✅ Departamento Obreiros criado')
  } else {
    // Atualiza ícone para bancos já existentes que tinham o ícone antigo
    db.run(`UPDATE departamentos SET icone = '🙏' WHERE nome = 'Obreiros' AND icone = '🤝'`)
  }

  // Garante que existe ao menos uma congregação sede
  const { n: nCong } = db.get('SELECT COUNT(*) as n FROM congregacoes') || { n: 0 }
  if (!nCong) {
    const { v4: uuidv4 } = require('uuid')
    const sedeId = uuidv4()
    db.run(`INSERT INTO congregacoes (id,nome,tipo,cidade,endereco,ativo,criado_em) VALUES (?,?,?,?,?,1,?)`,
      sedeId, 'Igreja Sede', 'sede', '', '', new Date().toISOString())
    // Vincula todos os usuários e escalas existentes à sede
    db.run(`UPDATE usuarios SET congregacao_id = ? WHERE congregacao_id IS NULL`, sedeId)
    db.run(`UPDATE escalas  SET congregacao_id = ? WHERE congregacao_id IS NULL`, sedeId)
    db.run(`UPDATE lancamentos_financeiro SET congregacao_id = ? WHERE congregacao_id IS NULL`, sedeId)
  }

  // ── PERFIS DE ACESSO ─────────────────────────────────────────────────────────
  db.exec(`
    CREATE TABLE IF NOT EXISTS perfis (
      id                          TEXT PRIMARY KEY,
      nome                        TEXT NOT NULL,
      acesso_financeiro           INTEGER NOT NULL DEFAULT 0,
      acesso_relatorio_financeiro INTEGER NOT NULL DEFAULT 0,
      acesso_financeiro_global    INTEGER NOT NULL DEFAULT 0,
      acesso_escala_global        INTEGER NOT NULL DEFAULT 0,
      acesso_cultos               INTEGER NOT NULL DEFAULT 0,
      criado_em                   TEXT NOT NULL
    );
  `)
  tryExec(`ALTER TABLE usuarios ADD COLUMN perfil_id TEXT REFERENCES perfis(id) ON DELETE SET NULL`)
  tryExec(
    `ALTER TABLE departamentos ADD COLUMN perfil_id TEXT REFERENCES perfis(id) ON DELETE SET NULL`
  )
  tryExec(`ALTER TABLE perfis   ADD COLUMN acesso_escalas           INTEGER NOT NULL DEFAULT 0`)
  tryExec(`ALTER TABLE perfis   ADD COLUMN acesso_comunicacoes      INTEGER NOT NULL DEFAULT 0`)
  tryExec(`ALTER TABLE usuarios ADD COLUMN acesso_escalas           INTEGER NOT NULL DEFAULT 0`)
  tryExec(`ALTER TABLE usuarios ADD COLUMN acesso_comunicacoes      INTEGER NOT NULL DEFAULT 0`)
  tryExec(`ALTER TABLE perfis   ADD COLUMN acesso_financeiro_saida  INTEGER NOT NULL DEFAULT 0`)
  tryExec(`ALTER TABLE usuarios ADD COLUMN acesso_financeiro_saida  INTEGER NOT NULL DEFAULT 0`)
  tryExec(`ALTER TABLE lancamentos_financeiro ADD COLUMN historico TEXT NOT NULL DEFAULT ''`)

  // ── VISITANTES ───────────────────────────────────────────────────────────────
  db.exec(`
    CREATE TABLE IF NOT EXISTS visitantes (
      id              TEXT PRIMARY KEY,
      nome            TEXT NOT NULL,
      celular         TEXT NOT NULL DEFAULT '',
      email           TEXT NOT NULL DEFAULT '',
      data_nascimento TEXT NOT NULL DEFAULT '',
      bairro          TEXT NOT NULL DEFAULT '',
      cidade          TEXT NOT NULL DEFAULT '',
      igreja_origem   TEXT NOT NULL DEFAULT '',
      como_conheceu   TEXT NOT NULL DEFAULT '',
      observacoes     TEXT NOT NULL DEFAULT '',
      cadastrado_por  TEXT REFERENCES usuarios(id) ON DELETE SET NULL,
      criado_em       TEXT NOT NULL,
      atualizado_em   TEXT NOT NULL
    );
  `)
  tryExec(`ALTER TABLE presencas ADD COLUMN visitante_id TEXT REFERENCES visitantes(id) ON DELETE SET NULL`)
  tryExec(`ALTER TABLE usuarios ADD COLUMN acesso_visitantes       INTEGER NOT NULL DEFAULT 0`)
  tryExec(`ALTER TABLE perfis   ADD COLUMN acesso_visitantes       INTEGER NOT NULL DEFAULT 0`)
  tryExec(`ALTER TABLE perfis   ADD COLUMN ver_totais_financeiro   INTEGER NOT NULL DEFAULT 0`)
  tryExec(`ALTER TABLE usuarios ADD COLUMN ver_totais_financeiro   INTEGER NOT NULL DEFAULT 0`)
  tryExec(`ALTER TABLE perfis   ADD COLUMN ver_totais_dia          INTEGER NOT NULL DEFAULT 0`)
  tryExec(`ALTER TABLE usuarios ADD COLUMN ver_totais_dia          INTEGER NOT NULL DEFAULT 0`)
  tryExec(`ALTER TABLE perfis   ADD COLUMN ver_subtotais_tipo      INTEGER NOT NULL DEFAULT 0`)
  tryExec(`ALTER TABLE usuarios ADD COLUMN ver_subtotais_tipo      INTEGER NOT NULL DEFAULT 0`)

  // Tabela genérica de configurações do sistema (chave → valor JSON)
  db.exec(`
    CREATE TABLE IF NOT EXISTS configuracoes (
      chave     TEXT PRIMARY KEY,
      valor     TEXT NOT NULL DEFAULT '',
      criado_em TEXT NOT NULL DEFAULT (datetime('now')),
      atualizado_em TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `)
}

/** Perfis macro (flags padrão). */
const PERFIS_MACRO = [
  {
    nome: 'Líder',
    acesso_financeiro: 0, acesso_relatorio_financeiro: 0, acesso_financeiro_global: 0,
    acesso_financeiro_saida: 0, acesso_escala_global: 0,
    acesso_cultos: 1, acesso_escalas: 1, acesso_comunicacoes: 1, acesso_visitantes: 1,
    ver_totais_financeiro: 0, ver_totais_dia: 0, ver_subtotais_tipo: 0
  },
  {
    nome: 'Obreiro — Recepção',
    acesso_financeiro: 0, acesso_relatorio_financeiro: 0, acesso_financeiro_global: 0,
    acesso_financeiro_saida: 0, acesso_escala_global: 0,
    acesso_cultos: 1, acesso_escalas: 0, acesso_comunicacoes: 0, acesso_visitantes: 1,
    ver_totais_financeiro: 0, ver_totais_dia: 0, ver_subtotais_tipo: 0
  },
  {
    nome: 'Obreiro — Financeiro',
    acesso_financeiro: 1, acesso_relatorio_financeiro: 0, acesso_financeiro_global: 0,
    acesso_financeiro_saida: 0, acesso_escala_global: 0,
    acesso_cultos: 1, acesso_escalas: 0, acesso_comunicacoes: 0, acesso_visitantes: 1,
    ver_totais_financeiro: 0, ver_totais_dia: 0, ver_subtotais_tipo: 0
  },
  {
    nome: 'Obreiro — Mídia',
    acesso_financeiro: 0, acesso_relatorio_financeiro: 0, acesso_financeiro_global: 0,
    acesso_financeiro_saida: 0, acesso_escala_global: 0,
    acesso_cultos: 1, acesso_escalas: 1, acesso_comunicacoes: 1, acesso_visitantes: 0,
    ver_totais_financeiro: 0, ver_totais_dia: 0, ver_subtotais_tipo: 0
  },
  {
    nome: 'Financeiro — Líder',
    acesso_financeiro: 1, acesso_relatorio_financeiro: 1, acesso_financeiro_global: 0,
    acesso_financeiro_saida: 1, acesso_escala_global: 0,
    acesso_cultos: 0, acesso_escalas: 0, acesso_comunicacoes: 0, acesso_visitantes: 0,
    ver_totais_financeiro: 1, ver_totais_dia: 1, ver_subtotais_tipo: 1
  }
]

const NOMES_DEPTO_MIDIA = ['Projeção', 'Ao Vivo', 'Stories', 'Iluminação', 'Fotos', 'Engajamento']

/**
 * Cria/atualiza os 5 perfis macro, migra nomes antigos, garante Tesouraria,
 * liga cada departamento ao perfil adequado. Idempotente — chamar após seedDepartamentos().
 */
function sincronizarPerfisMacro() {
  const { v4: uuidv4 } = require('uuid')
  const agora = new Date().toISOString()

  // Migra nomes legados para os novos antes de upsert
  const renomear = [
    ['Financeiro', 'Financeiro — Líder'],
    ['Obreiro',    'Obreiro — Recepção'],
    ['Mídia',      'Obreiro — Mídia'],
    ['Midia',      'Obreiro — Mídia'],
    ['Cultos',     'Obreiro — Recepção'],
  ]
  for (const [antigo, novo] of renomear) {
    const existe  = db.get('SELECT id FROM perfis WHERE nome = ?', antigo)
    const jaExiste = db.get('SELECT id FROM perfis WHERE nome = ?', novo)
    if (existe && !jaExiste) {
      db.run('UPDATE perfis SET nome = ? WHERE nome = ?', novo, antigo)
    } else if (existe && jaExiste) {
      // Migra usuários e departamentos para o perfil correto e remove o duplicado
      db.run('UPDATE usuarios     SET perfil_id = ? WHERE perfil_id = ?', jaExiste.id, existe.id)
      db.run('UPDATE departamentos SET perfil_id = ? WHERE perfil_id = ?', jaExiste.id, existe.id)
      db.run('DELETE FROM perfis WHERE id = ?', existe.id)
    }
  }

  for (const p of PERFIS_MACRO) {
    const row = db.get('SELECT id FROM perfis WHERE nome = ?', p.nome)
    if (!row) {
      db.run(
        `INSERT INTO perfis (id,nome,acesso_financeiro,acesso_relatorio_financeiro,acesso_financeiro_global,acesso_financeiro_saida,acesso_escala_global,acesso_cultos,acesso_escalas,acesso_comunicacoes,acesso_visitantes,ver_totais_financeiro,ver_totais_dia,ver_subtotais_tipo,criado_em) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
        uuidv4(), p.nome,
        p.acesso_financeiro, p.acesso_relatorio_financeiro, p.acesso_financeiro_global,
        p.acesso_financeiro_saida, p.acesso_escala_global,
        p.acesso_cultos, p.acesso_escalas, p.acesso_comunicacoes, p.acesso_visitantes,
        p.ver_totais_financeiro, p.ver_totais_dia, p.ver_subtotais_tipo, agora
      )
    } else {
      db.run(
        `UPDATE perfis SET acesso_financeiro=?,acesso_relatorio_financeiro=?,acesso_financeiro_global=?,acesso_financeiro_saida=?,acesso_escala_global=?,acesso_cultos=?,acesso_escalas=?,acesso_comunicacoes=?,acesso_visitantes=?,ver_totais_financeiro=?,ver_totais_dia=?,ver_subtotais_tipo=? WHERE nome=?`,
        p.acesso_financeiro, p.acesso_relatorio_financeiro, p.acesso_financeiro_global,
        p.acesso_financeiro_saida, p.acesso_escala_global,
        p.acesso_cultos, p.acesso_escalas, p.acesso_comunicacoes, p.acesso_visitantes,
        p.ver_totais_financeiro, p.ver_totais_dia, p.ver_subtotais_tipo, p.nome
      )
    }
  }

  const finLider  = db.get(`SELECT id FROM perfis WHERE nome = 'Financeiro — Líder'`)
  const obrRec    = db.get(`SELECT id FROM perfis WHERE nome = 'Obreiro — Recepção'`)
  const obrMidia  = db.get(`SELECT id FROM perfis WHERE nome = 'Obreiro — Mídia'`)

  let tes = db.get(`SELECT id FROM departamentos WHERE nome = 'Tesouraria'`)
  if (!tes && finLider) {
    const tid = uuidv4()
    db.run(
      `INSERT INTO departamentos (id,nome,descricao,icone,cor,mensagem_pastoral,ativo,criado_em,perfil_id) VALUES (?,?,?,?,?,?,1,?,?)`,
      tid, 'Tesouraria', 'Dízimos, ofertas e lançamentos financeiros', '💰', '#1E8449', '', agora, finLider.id
    )
  } else if (tes && finLider) {
    db.run(`UPDATE departamentos SET perfil_id = ? WHERE nome = 'Tesouraria'`, finLider.id)
  }

  if (obrRec)   db.run(`UPDATE departamentos SET perfil_id = ? WHERE nome = 'Obreiros'`, obrRec.id)
  if (obrMidia && NOMES_DEPTO_MIDIA.length) {
    const ph = NOMES_DEPTO_MIDIA.map(() => '?').join(',')
    db.run(`UPDATE departamentos SET perfil_id = ? WHERE nome IN (${ph})`, obrMidia.id, ...NOMES_DEPTO_MIDIA)
    db.run(
      `UPDATE departamentos SET perfil_id = ? WHERE perfil_id IS NULL AND nome NOT IN ('Obreiros','Tesouraria')`,
      obrMidia.id
    )
  }
}

module.exports = { initSchema, seedDepartamentos, migrate, sincronizarPerfisMacro }
