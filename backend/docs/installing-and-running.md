# Installation

The backend uses [TypeORM](https://www.npmjs.com/package/typeorm) with [PostgreSQL](https://www.postgresql.org/). It runs natively on Windows, macOS and Linux; no Docker is needed.

---

## Table of Contents <!-- omit in toc -->

- [Development setup (PostgreSQL + TypeORM)](#development-setup-postgresql--typeorm)
  - [Video guideline (PostgreSQL + TypeORM)](#video-guideline-postgresql--typeorm)
- [Test database](#test-database)
- [Links](#links)

---

## Development setup (PostgreSQL + TypeORM)

1. Go to the `backend` folder and copy `.env.example` as `.env`.

   ```bash
   cd backend
   cp .env.example .env
   ```

   In PowerShell, use `Copy-Item .env.example .env`.

1. Make sure PostgreSQL is available. Either install it locally (the defaults in `.env` expect `localhost:5432`) or point the `DATABASE_*` values in `.env` at a hosted PostgreSQL instance.

1. Optional: run a local mail catcher for auth emails (SMTP on port 1025, web UI on port 1080):

   ```bash
   npx maildev
   ```

1. Install dependencies

   ```bash
   npm install
   ```

1. Run migrations

   ```bash
   npm run migration:run
   ```

1. Run seeds

   ```bash
   npm run seed:run:relational
   ```

1. Run app in dev mode

   ```bash
   npm run start:dev
   ```

1. Open <http://localhost:3001>

### Video guideline (PostgreSQL + TypeORM)

<https://github.com/user-attachments/assets/136a16aa-f94a-4b20-8eaf-6b4262964315>

---

## Test database

End-to-end tests use their own database (`api_test` by default), never the dev database. See [Tests](tests.md) for details.

1. Copy `.env.test.example` as `.env.test` and set the database credentials. The user needs permission to create databases (`CREATEDB`), or create `api_test` yourself first.

   ```bash
   cp .env.test.example .env.test
   ```

1. Create and migrate the test database:

   ```bash
   npm run test:db:setup
   ```

1. Run the tests:

   ```bash
   npm test
   npm run test:e2e
   ```

---

## Links

- Swagger (API docs): <http://localhost:3001/docs>
- Maildev: <http://localhost:1080>

---

Previous: [Introduction](introduction.md)

Next: [Architecture](architecture.md)
