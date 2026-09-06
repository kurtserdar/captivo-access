#!/bin/sh
# One-shot schema migration. Seeds the default tenant so the tenantId FKs
# validate, then applies the schema. Phase 0b will append the RLS bootstrap.
set -e
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f prisma/rls/pre-push.sql
./node_modules/.bin/prisma db push --schema=prisma/schema.prisma
# Phase 0b appends: psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f prisma/rls/bootstrap.sql
