#!/usr/bin/env node
import { runReferralPackageBuilderFromStdin } from './referral-package-builder.ts'

await runReferralPackageBuilderFromStdin(process.stdin)
