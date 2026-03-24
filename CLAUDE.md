# Jovi Claw — Claude Code Project Context

## Project Identity
**Jovi AI** — Elite autonomous AI operator for Boss (GBAIjovi) at Green Build AI.
Runs as a **WhatsApp + Telegram bot** deployed on **Railway**. Jovi is not a chatbot — she is an autonomous execution agent.

> Always address the user as **Boss**.

---

## Tech Stack
- **Runtime:** Node.js 20+ · TypeScript (ESM modules)
- **Bots:** `grammy` (Telegram) · `whatsapp-web.js` (WhatsApp)
- **LLM:** OpenAI SDK (`openai`) · Claude API (`@anthropic-ai/sdk`)
- **Database:** Turso/libSQL (`@libsql/client`) · SQLite (`jovi_memory.db`)
- **Memory:** 3-Tier — Buffer / Core / Semantic (via Qdrant)
- **Scheduling:** `node-schedule`
- **MCP:** `@modelcontextprotocol/sdk` — Zapier, Filesystem, custom tools
- **Deployment:** Railway (`railway.json` · `Dockerfile`)
- **Dev runner:** `tsx` (no compile step in dev)

---

## Architecture

```
src/
├── index.ts              ← Entrypoint — boots all subsystems
├── config/
│   ├── env.ts            ← Environment variables
│   └── soul.md           ← Jovi's character, identity, capability directives
├── bot/
│   ├── bot.ts            ← Telegram bot (grammy)
│   ├── whatsapp-integration.ts  ← WhatsApp client (whatsapp-web.js)
│   ├── middleware.ts      ← Bot middleware chain
│   └── loop.ts           ← Message processing loop
├── agent/
│   ├── loop.ts           ← Core agent reasoning loop
│   ├── orchestrator-cron.ts  ← Autonomous cron orchestrator
│   ├── retrospective.ts  ← Self-review cycles
│   └── self-healing.ts   ← Auto-recovery
├── llm/
│   └── claude.ts         ← Claude API integration (credit alerts)
├── tools/
│   ├── index.ts          ← Tool registry (auto-loaded)
│   ├── remote-pc-*.ts    ← PC remote control (Agent Mode)
│   ├── remember-fact.ts  ← Memory write
│   ├── recall-memory.ts  ← Memory read
│   └── ...               ← All other tools
├── scheduler/            ← Heartbeat, cron jobs
├── security/             ← Zero-trust auth layer
├── utils/
│   ├── memory.ts         ← libSQL memory DB
│   ├── semantic.ts       ← Qdrant semantic search
│   ├── mcp-client.ts     ← MCP connections
│   ├── heartbeat-state.ts
│   └── remote-relay.ts   ← WebSocket relay for remote PC
└── voice/                ← Voice input/output
```

---

## Commands

```bash
npm run dev        # Run in dev mode (tsx, no compile)
npm run build      # TypeScript compile → dist/
npm start          # Run compiled dist/index.js (production)
npm run remote-agent      # Start remote agent relay
npm run remote-bootstrapper  # Start bootstrapper
```

---

## Key Files
- `.env` — All secrets (NEVER hardcode credentials)
- `src/config/soul.md` — Jovi's soul/character directives (edit carefully)
- `mcp_config.json` — Local MCP server connections
- `mcp_config.railway.json` — Railway MCP config
- `railway.json` — Railway deployment config
- `Dockerfile` — Container build
- `jovi_memory.db` — Local SQLite memory (not committed)

---

## Deployment
- **Platform:** Railway
- **Environment:** All secrets in Railway environment variables
- **WhatsApp auth:** `whatsapp_auth_jovi/` folder (persisted via Railway volume)
- **Branch:** `master` → auto-deploys

---

## Behavioral Rules
- **Never hardcode** credentials, API keys, or secrets — always use `process.env.*`
- **Never break** Jovi's soul — changes to `soul.md` require care
- **Always use ESM** imports (`.js` extension on relative imports, even for `.ts` sources)
- **Remote PC tools** are gated behind Agent Mode — never expose them when mode is OFF
- **WhatsApp session** is fragile — avoid restarts in production without auth backup

---

## Green Build AI Products
- **EcoCraft Designer** — AI CAD tool, NBC 2016 compliant
- **Green Pick** — Eco material selection
- **BuildSight AI** — CV safety monitoring (`e:\Company\Green Build AI\Prototypes\BuildSight`)
- **Jovi AI** — This project
