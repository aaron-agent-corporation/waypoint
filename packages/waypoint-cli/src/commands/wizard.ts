import {
  createWizardShadows,
  isWizardDomain,
  nextWizardQuestion,
  readWizardAnswers,
  readWizardQuestions,
  recordWizardAnswer,
  scanWizardSource,
} from '@waypoint/core'

import type { WaypointCliIo } from '../bin'

export async function runWizardCommand(args: readonly string[], io: WaypointCliIo): Promise<number> {
  const [subcommand] = args

  if (subcommand === 'scan') {
    return runWizardScan(args.slice(1), io)
  }

  if (subcommand === 'shadow') {
    return runWizardShadow(args.slice(1), io)
  }

  if (subcommand === 'questions') {
    return runWizardQuestions(args.slice(1), io)
  }

  if (subcommand === 'answer') {
    return runWizardAnswer(args.slice(1), io)
  }

  io.stderr(`Unknown Wizard subcommand: ${subcommand ?? '(none)'}`)
  io.stderr('Run waypoint wizard --help for usage.')
  return 1
}

export async function runWizardScan(args: readonly string[], io: WaypointCliIo): Promise<number> {
  let sourcePath: string | undefined
  let domain: string | undefined
  let jsonOutput = false

  for (let i = 0; i < args.length; i++) {
    const arg = args[i]
    if (arg === '--source' || arg === '-s') {
      sourcePath = args[++i]
    } else if (arg === '--domain' || arg === '-d') {
      domain = args[++i]
    } else if (arg === '--json' || arg === '-j') {
      jsonOutput = true
    } else {
      io.stderr(`Unknown option: ${arg}`)
      return 1
    }
  }

  if (!sourcePath) {
    io.stderr('Missing required option: --source <path>')
    return 1
  }

  if (!domain) {
    io.stderr('Missing required option: --domain <domain>')
    return 1
  }

  if (!isWizardDomain(domain)) {
    io.stderr(`Unsupported Wizard domain: ${domain}`)
    return 1
  }

  try {
    const result = await scanWizardSource({ sourceRoot: sourcePath, domain })

    if (jsonOutput) {
      io.stdout(JSON.stringify(result, null, 2))
    } else {
      io.stdout(`Waypoint Wizard Scan`)
      io.stdout(`=========================`)
      io.stdout(`Source: ${result.source_root}`)
      io.stdout(`Domain: ${result.domain}`)
      io.stdout(`Files found: ${result.files_found}`)
      if (result.warnings.length > 0) {
        io.stdout(`Warnings:`)
        for (const warning of result.warnings) {
          io.stdout(`  - ${warning}`)
        }
      }
    }

    return 0
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error)
    io.stderr(message)
    return 1
  }
}

export async function runWizardShadow(args: readonly string[], io: WaypointCliIo): Promise<number> {
  let sourcePath: string | undefined
  let targetPath: string | undefined
  let domain: string | undefined
  let jsonOutput = false

  for (let i = 0; i < args.length; i++) {
    const arg = args[i]
    if (arg === '--source' || arg === '-s') {
      sourcePath = args[++i]
    } else if (arg === '--target' || arg === '-t') {
      targetPath = args[++i]
    } else if (arg === '--domain' || arg === '-d') {
      domain = args[++i]
    } else if (arg === '--json' || arg === '-j') {
      jsonOutput = true
    } else {
      io.stderr(`Unknown option: ${arg}`)
      return 1
    }
  }

  if (!sourcePath) {
    io.stderr('Missing required option: --source <path>')
    return 1
  }

  if (!targetPath) {
    io.stderr('Missing required option: --target <case-root>')
    return 1
  }

  if (!domain) {
    io.stderr('Missing required option: --domain <domain>')
    return 1
  }

  if (!isWizardDomain(domain)) {
    io.stderr(`Unsupported Wizard domain: ${domain}`)
    return 1
  }

  try {
    const scan = await scanWizardSource({ sourceRoot: sourcePath, domain })
    const shadowResult = await createWizardShadows({ scan, targetRoot: targetPath, domain })
    const response = {
      domain,
      source_root: scan.source_root,
      target_root: shadowResult.target_root,
      shadows_created: shadowResult.shadows.length,
      shadow_paths: shadowResult.shadows.map((shadow) => shadow.shadow_path),
      shadows: shadowResult.shadows,
      warnings: scan.warnings,
    }

    if (jsonOutput) {
      io.stdout(JSON.stringify(response, null, 2))
    } else {
      io.stdout(`Waypoint Wizard Shadows`)
      io.stdout(`========================`)
      io.stdout(`Source: ${scan.source_root}`)
      io.stdout(`Target: ${shadowResult.target_root}`)
      io.stdout(`Domain: ${domain}`)
      io.stdout(`Shadows created: ${shadowResult.shadows.length}`)
    }

    return 0
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error)
    io.stderr(message)
    return 1
  }
}

export async function runWizardQuestions(args: readonly string[], io: WaypointCliIo): Promise<number> {
  let casePath: string | undefined
  let jsonOutput = false

  for (let i = 0; i < args.length; i++) {
    const arg = args[i]
    if (arg === '--case' || arg === '-c') {
      casePath = args[++i]
    } else if (arg === '--json' || arg === '-j') {
      jsonOutput = true
    } else {
      io.stderr(`Unknown option: ${arg}`)
      return 1
    }
  }

  if (!casePath) {
    io.stderr('Missing required option: --case <case-root>')
    return 1
  }

  try {
    const questions = await readWizardQuestions({ caseRoot: casePath })
    const answers = await readWizardAnswers({ caseRoot: casePath })
    const nextQuestion = nextWizardQuestion(questions, answers) ?? null
    const response = {
      case_root: casePath,
      questions_found: questions.length,
      answers_found: answers.length,
      pending_count: questions.filter((question) => question.status === 'pending' && !answers.some((answer) => answer.question_id === question.id)).length,
      next_question: nextQuestion,
      questions,
      answers,
    }

    if (jsonOutput) {
      io.stdout(JSON.stringify(response, null, 2))
    } else {
      io.stdout(`Waypoint Wizard Questions`)
      io.stdout(`=========================`)
      io.stdout(`Case: ${casePath}`)
      io.stdout(`Questions found: ${questions.length}`)
      if (nextQuestion) {
        io.stdout(`Next question: ${nextQuestion.id}`)
        io.stdout(nextQuestion.prompt)
      } else {
        io.stdout('Next question: none')
      }
    }

    return 0
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error)
    io.stderr(message)
    return 1
  }
}

export async function runWizardAnswer(args: readonly string[], io: WaypointCliIo): Promise<number> {
  let casePath: string | undefined
  let questionId: string | undefined
  let answerText: string | undefined
  let jsonOutput = false

  for (let i = 0; i < args.length; i++) {
    const arg = args[i]
    if (arg === '--case' || arg === '-c') {
      casePath = args[++i]
    } else if (arg === '--question' || arg === '-q') {
      questionId = args[++i]
    } else if (arg === '--answer' || arg === '-a') {
      answerText = args.slice(i + 1).filter((token) => token !== '--json' && token !== '-j').join(' ')
      jsonOutput = jsonOutput || args.slice(i + 1).some((token) => token === '--json' || token === '-j')
      break
    } else if (arg === '--json' || arg === '-j') {
      jsonOutput = true
    } else {
      io.stderr(`Unknown option: ${arg}`)
      return 1
    }
  }

  if (!casePath) {
    io.stderr('Missing required option: --case <case-root>')
    return 1
  }

  if (!questionId) {
    io.stderr('Missing required option: --question <id>')
    return 1
  }

  if (!answerText || answerText.trim().length === 0) {
    io.stderr('Missing required option: --answer <text>')
    return 1
  }

  try {
    const result = await recordWizardAnswer({
      caseRoot: casePath,
      questionId,
      answer: answerText,
    })
    const questions = await readWizardQuestions({ caseRoot: casePath })
    const answers = await readWizardAnswers({ caseRoot: casePath })
    const nextQuestion = nextWizardQuestion(questions, answers) ?? null
    const response = {
      case_root: casePath,
      answer_path: result.path,
      answer_relative_path: result.relative_path,
      answers_written: result.answers_written,
      answer: result.answer,
      next_question: nextQuestion,
    }

    if (jsonOutput) {
      io.stdout(JSON.stringify(response, null, 2))
    } else {
      io.stdout(`Waypoint Wizard Answer`)
      io.stdout(`======================`)
      io.stdout(`Case: ${casePath}`)
      io.stdout(`Question: ${result.answer.question_id}`)
      io.stdout(`Answers written: ${result.answers_written}`)
      if (nextQuestion) {
        io.stdout(`Next question: ${nextQuestion.id}`)
        io.stdout(nextQuestion.prompt)
      } else {
        io.stdout('Next question: none')
      }
    }

    return 0
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error)
    io.stderr(message)
    return 1
  }
}
