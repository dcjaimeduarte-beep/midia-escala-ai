# 🔥 Midia Escala AI

> Sistema de gestão da equipe de mídia da **Peniel Ministério Profético Casa de Adoração**  
> Powered by Claude Sonnet 4.6 (Anthropic)

---

## Stack

| Camada | Tecnologia |
|--------|-----------|
| Servidor | Node.js + Express |
| IA | Claude Sonnet 4.6 via `@anthropic-ai/sdk` |
| Banco | In-memory (migração para PostgreSQL planejada) |
| Eventos | Node.js EventEmitter |
| Datas | moment.js (formato DD/MM/AAAA) |

---

## Estrutura

```
src/
├── agents/
│   └── pastorDaMidia.js     # Agente IA principal
├── controllers/
│   └── departamentoController.js
├── events/
│   └── eventBus.js          # EventEmitter singleton
├── models/
│   └── db.js                # Banco in-memory
├── routes/
│   ├── agenteRoutes.js      # POST /agente/perguntar
│   ├── departamentoRoutes.js
│   └── escalaRoutes.js
├── theme/
│   ├── brand.js             # Tokens visuais da Peniel
│   └── template.html        # Template HTML com identidade visual
└── server.js

docs/
├── TAREFAS.md               # Backlog completo do projeto
├── ROTAS.md                 # Documentação de endpoints
├── AGENTE.md                # Documentação do Pastor da Mídia
├── LOGO OFICIAL.png
└── Foguinho vazado.png
```

---

## Instalação

```bash
# Clonar e instalar
npm install

# Configurar variáveis de ambiente
cp .env.example .env
# Editar .env e adicionar ANTHROPIC_API_KEY

# Rodar em desenvolvimento
npm run dev
```

---

## Variáveis de Ambiente

```env
ANTHROPIC_API_KEY=sk-ant-...
PORT=3000
```

---

## Endpoints principais

| Método | Rota | Descrição |
|--------|------|-----------|
| POST | `/departamento/criar` | Criar departamento |
| GET | `/departamento/listar` | Listar departamentos |
| POST | `/departamento/vincular` | Vincular usuário ao depto |
| POST | `/escala/criar` | Criar escala |
| GET | `/escala/minhas/:id` | Escalas do usuário |
| POST | `/agente/perguntar` | Consultar o Pastor da Mídia IA |

Documentação completa: [docs/ROTAS.md](docs/ROTAS.md)

---

## Pastor da Mídia — IA

Agente inteligente que:
- Cria e organiza escalas de serviço
- Sugere voluntários disponíveis
- Detecta conflitos e vagas abertas
- Notifica a equipe via eventBus
- Responde em português com tom pastoral

```bash
curl -X POST http://localhost:3000/agente/perguntar \
  -H "Content-Type: application/json" \
  -d '{"pergunta":"Crie uma escala para câmera no dia 11/05/2026"}'
```

Documentação completa: [docs/AGENTE.md](docs/AGENTE.md)

---

## Identidade Visual

Paleta oficial da **Peniel Ministério Profético Casa de Adoração**:

| Token | Cor |
|-------|-----|
| Vermelho primário | `#D4161B` |
| Chama | `#E8000D` |
| Dourado | `#FFB300` |
| Fundo escuro | `#0F0000` |

Tokens completos: [src/theme/brand.js](src/theme/brand.js)

---

## Documentação

| Arquivo | Conteúdo |
|---------|----------|
| [docs/TAREFAS.md](docs/TAREFAS.md) | Backlog completo — concluído, em andamento, pendente |
| [docs/ROTAS.md](docs/ROTAS.md) | Todos os endpoints com exemplos |
| [docs/AGENTE.md](docs/AGENTE.md) | Tools, eventos e exemplos do Pastor da Mídia |
| [docs/DEPLOY_LOCAWEB.md](docs/DEPLOY_LOCAWEB.md) | Publicação em produção na Locaweb |
