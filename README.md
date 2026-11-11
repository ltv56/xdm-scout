# xdm-scout

Web app to find AI and robotics people on X, write DMs backed by real posts, send them after a human approves, and track replies. It never sends the same first message twice.

Status: early setup. Only the project skeleton and a health check exist so far.

## Stack

- API: NestJS, TypeORM, MySQL 8
- Web: React, Vite, Tailwind, TanStack Query
- Docker Compose for the database

## Requirements

- Node.js 22 or newer
- Docker

## Run locally

```bash
cp .env.example .env
npm install
npm run db:up
npm run db:migrate -w apps/api
npm run dev:api   # http://localhost:3001/api/health
npm run dev:web   # http://localhost:3000
```

## Checks

```bash
npm run lint
npm run typecheck
npm test        # needs the database running
npm run build
```

## Layout

```
apps/api   NestJS API and worker
apps/web   React app
infra      database init script
```
