#!/usr/bin/env bun
import { runCli } from './review-loop/cli.js'

await runCli(Bun.argv.slice(2))
