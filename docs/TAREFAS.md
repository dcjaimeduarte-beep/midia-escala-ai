# 📋 Tarefas do Projeto — Midia Escala AI

> Sistema de gestão da equipe de mídia da **Peniel Ministério Profético Casa de Adoração**
> Última atualização: 05/05/2026

---

## ✅ Concluído

### Infraestrutura Base
- [x] Inicializar projeto Node.js (`npm init`)
- [x] Instalar dependências: `express`, `dotenv`, `moment`, `uuid`, `nodemon`
- [x] Instalar `@anthropic-ai/sdk`
- [x] Configurar `package.json` com script `dev` e `main: src/server.js`

### Banco de Dados (In-Memory)
- [x] Criar `src/models/db.js` com coleções: `usuarios`, `departamentos`, `usuario_departamento`, `escalas`

### Rotas e Controllers
- [x] `src/routes/departamentoRoutes.js` — POST `/criar`, GET `/listar`, POST `/vincular`
- [x] `src/routes/escalaRoutes.js` — POST `/criar`, GET `/minhas/:usuario_id`
- [x] `src/routes/agenteRoutes.js` — POST `/agente/perguntar`
- [x] `src/controllers/departamentoController.js` — CRUD completo

### Eventos
- [x] `src/events/eventBus.js` — EventEmitter singleton
- [x] Listener `escala_criada` no server.js
- [x] Listener `notificacao_equipe` no server.js

### Agente IA — Pastor da Mídia
- [x] `src/agents/pastorDaMidia.js` — Loop agêntico com Claude Sonnet 4.6
- [x] Prompt caching no system prompt
- [x] 6 ferramentas (tools): `listar_departamentos`, `listar_usuarios`, `sugerir_voluntarios`, `criar_escala`, `listar_escalas`, `notificar_equipe`
- [x] Emissão de eventos via eventBus ao criar escalas
- [x] Datas no formato brasileiro DD/MM/AAAA

### Identidade Visual
- [x] `src/theme/brand.js` — Tokens de design da Peniel (cores, tipografia, gradientes)
- [x] `src/theme/template.html` — Template HTML completo com identidade visual
- [x] Logos importadas: `Foguinho vazado.png`, `LOGO OFICIAL.png`

### Servidor
- [x] `src/server.js` — Express com todas as rotas registradas

---

## 🔄 Em Andamento

### Frontend
- [ ] Criar interface React ou HTML puro consumindo a API
- [ ] Implementar chat com o Pastor da Mídia no browser
- [ ] Aplicar `src/theme/template.html` como base do frontend

### Persistência
- [ ] Substituir banco in-memory por banco real (SQLite ou PostgreSQL)
- [ ] Criar migrations das tabelas: `usuarios`, `departamentos`, `usuario_departamento`, `escalas`

---

## 📌 Pendente

### Usuários
- [x] `POST /auth/cadastro` — cadastro de voluntário
- [x] `POST /auth/login` — login com JWT
- [x] `GET /auth/me` — perfil do usuário logado
- [x] `GET /usuario/listar` — admin vê todos, líder vê só o seu depto
- [x] `GET /usuario/:id` — perfil com departamentos
- [x] `PUT /usuario/:id` — editar perfil
- [x] `POST /usuario/vincular` — vincular com role_depto (lider/membro) e acesso_departamentos
- [x] `PUT /usuario/:id/acesso` — admin concede/revoga acesso a outros deptos
- [x] `DELETE /usuario/:id/desvincular` — remove do departamento
- [ ] Campo `habilidades` no usuário (ex: câmera, som, projeção)
- [ ] Campo `disponibilidade` (dias da semana disponíveis)
- [ ] Upload de avatar/foto de perfil

### Escalas
- [x] `GET /escala/listar` — admin vê tudo
- [x] `GET /escala/departamento/:id` — escalas por departamento (requer acesso)
- [ ] `PUT /escala/:id` — editar escala existente
- [ ] `DELETE /escala/:id` — remover escala
- [ ] Validação: impedir escalar mesmo voluntário 2x no mesmo dia
- [ ] Regra: máximo 3 escalas por mês por voluntário por departamento

### Departamentos
- [x] `PUT /departamento/:id` — editar departamento (admin)
- [x] `DELETE /departamento/:id` — desativar departamento (admin)
- [x] Líder por departamento (role_depto: 'lider')
- [x] Listar membros de um departamento (GET /departamento/:id)
- [x] 6 departamentos pré-cadastrados no boot do sistema
- [ ] Reordenação dos departamentos

### Notificações
- [ ] Sistema de notificação por WhatsApp (via Twilio ou Z-API)
- [ ] Notificação por e-mail ao criar escala (Nodemailer)
- [ ] Notificação push no browser (Web Push API)
- [ ] Lembrete automático 7 dias antes da escala

### Agente IA — Melhorias
- [ ] Ferramenta `verificar_conflitos` — detectar voluntário escalado em dois lugares ao mesmo tempo
- [ ] Ferramenta `gerar_escala_mensal` — criar todas as escalas do mês de uma vez
- [ ] Ferramenta `relatorio_frequencia` — quantas vezes cada voluntário serviu
- [ ] Ferramenta `listar_escalas_abertas` — escalas sem voluntário suficiente
- [ ] Streaming da resposta do agente em tempo real (SSE)
- [ ] Histórico de conversa por sessão (contexto multi-turn)
- [ ] Memória persistente do agente (lembrar preferências e padrões)

### Autenticação
- [x] Login com JWT (`/auth/login`)
- [x] Cadastro (`/auth/cadastro`)
- [x] Perfis: `admin` | `lider` | `membro`
- [x] Middleware `autenticar`, `apenasAdmin`, `verificarAcessoDepartamento`
- [x] `.env.example` com `JWT_SECRET`
- [ ] Tela de login com identidade visual da Peniel
- [ ] Refresh token
- [ ] Recuperação de senha

### Frontend Completo
- [ ] Página de dashboard (próximas escalas, vagas abertas, alertas)
- [ ] Página de escalas (calendário mensal com escalas)
- [ ] Página de equipe (lista de voluntários por departamento)
- [ ] Página de departamentos (CRUD)
- [ ] Chat do Pastor da Mídia com streaming
- [ ] Modo escuro (já preparado no tema)
- [ ] Responsivo para mobile

### Relatórios
- [ ] Exportar escala do mês em PDF
- [ ] Exportar lista de voluntários em CSV
- [ ] Relatório de frequência por período

### Deploy
- [ ] Criar `.env.example` com variáveis necessárias
- [ ] Dockerfile para containerização
- [ ] Deploy na VPS ou Railway/Render
- [ ] Configurar domínio e HTTPS

---

## 🐛 Bugs Conhecidos

_Nenhum até o momento._

---

## 💡 Ideias Futuras

- [ ] App mobile (React Native) para voluntários consultarem suas escalas
- [ ] Integração com Google Calendar — sincronizar escalas automaticamente
- [ ] QR Code de confirmação de presença no culto
- [ ] Geração automática de arte para redes sociais com a escala da semana
- [ ] Votação: voluntários indicam preferência de datas

---

## 🔗 Referências

- [Anthropic SDK Docs](https://platform.claude.com/docs)
- [Express.js](https://expressjs.com)
- [Moment.js](https://momentjs.com)
