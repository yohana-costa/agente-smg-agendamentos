#!/bin/sh
set -e
# Mesmo fluxo do Gestor SMG varejo: sincroniza o schema e popula o seed antes de subir.
npx prisma db push --skip-generate
npm run seed
exec npm run start
