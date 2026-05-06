type VirtualSourceFile = {
  path: string
  content: string
}

type BoundaryViolation = {
  path: string
  importPath: string
  rule: string
}

const BLOCKED_IMPORT_RULES = [
  { rule: 'next/*', matcher: /^next\// },
  { rule: '@/lib/*', matcher: /^@\/lib\// },
  { rule: '@/app/*', matcher: /^@\/app\// },
  { rule: '@/components/*', matcher: /^@\/components\// },
]

const IMPORT_PATH_REGEX = /from\s+['"]([^'"]+)['"]|import\s+['"]([^'"]+)['"]/g

export function findCoreBoundaryViolations(files: VirtualSourceFile[]): BoundaryViolation[] {
  const violations: BoundaryViolation[] = []

  for (const file of files) {
    for (const importPath of extractImportPaths(file.content)) {
      const blocked = BLOCKED_IMPORT_RULES.find(({ matcher }) => matcher.test(importPath))
      if (blocked) {
        violations.push({ path: file.path, importPath, rule: blocked.rule })
      }
    }
  }

  return violations
}

function extractImportPaths(content: string): string[] {
  const paths: string[] = []
  for (const match of content.matchAll(IMPORT_PATH_REGEX)) {
    const importPath = match[1] || match[2]
    if (importPath) paths.push(importPath)
  }
  return paths
}
