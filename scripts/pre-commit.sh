#!/bin/sh
set -e

bun run format
bun run lint:fix

git add -u
