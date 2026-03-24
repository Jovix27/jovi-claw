---
name: deploy
description: Deploy Jovi to Railway — build, verify, commit, push
tools: Read, Bash, Glob, Grep
---

Deploy Jovi Claw to Railway production.

## Steps

1. **TypeScript check** — run `npx tsc --noEmit` and fix any errors before continuing.
2. **Build** — run `npm run build` and confirm the `dist/` folder is populated.
3. **Git status** — show what changed with `git status` and `git diff --stat`.
4. **Commit** — stage relevant source files (never `.env`, `jovi_memory.db`, `whatsapp_auth_jovi/`, log files) and create a commit.
5. **Push** — push to `master`. Railway auto-deploys on push.
6. **Confirm** — tell Boss the push is done and Railway deploy is triggered.

## Rules
- Never commit: `.env`, `*.db`, `whatsapp_auth_jovi/`, `*.log`, `cloud_logs.txt`, `debug_*.log`
- Always run `tsc --noEmit` first — broken TypeScript will break the Railway build
- If build fails, fix errors before pushing
- Remind Boss to check Railway dashboard for deploy status
