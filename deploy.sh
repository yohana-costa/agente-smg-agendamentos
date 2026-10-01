#!/bin/sh
set -e
git pull --ff-only
docker compose up -d --build --remove-orphans
docker compose ps
