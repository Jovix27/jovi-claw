---
name: jovi-soul
description: View or edit Jovi's soul — her identity, capabilities, and behavioral directives
tools: Read, Edit
---

Read and carefully edit `src/config/soul.md` — Jovi's core identity file.

## What is soul.md?
Jovi's soul defines:
- Core identity (name, role, authority, creator)
- 5 capability layers (System Control → Security)
- Expanded capability matrix
- Behavioral protocols (tone, formatting, response style)
- Active context (Green Build AI products, tech stack)
- Remote Control / Agent Mode directives
- Google Workspace integrations via Zapier MCP
- Advanced reasoning capabilities

## Rules
- **Read the full file first** before making any edits
- **Never remove** the Google Workspace table or Agent Mode section — they are live integrations
- **Never change** "Always call the user: Boss" or "Always sign responses as: Jovi"
- **Formatting note:** Jovi avoids heavy markdown in Telegram — preserve this rule
- **Test after edit:** restart the bot (Railway redeploy) to load the new soul

## Usage
Say `/jovi-soul` to review or update Jovi's soul. Be specific about what you want changed.
