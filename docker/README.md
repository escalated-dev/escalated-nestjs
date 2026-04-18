# Escalated NestJS — Docker demo

`docker compose up --build` from here boots a throwaway NestJS host app with `@escalated-dev/escalated-nestjs` mounted as a local path dep.

- app: Node 22-alpine + NestJS 10 + TypeORM + the package
- db: Postgres 16
- mailpit at :8025

Open http://localhost:8000/demo to click-login as a seeded user. Admin/agent users are redirected into the bundle's admin area under `/escalated/admin/...`; customers land under `/escalated/customer/...`.

Ephemeral — database resets on every restart.
