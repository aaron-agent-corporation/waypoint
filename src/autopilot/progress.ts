export interface WaypointAutopilotProgressInput {
  timerCompleted: unknown[]
  createdCounts: number[]
}

export function hasWaypointAutopilotProgress(input: WaypointAutopilotProgressInput): boolean {
  if (input.timerCompleted.length > 0) return true
  return input.createdCounts.some((count) => count > 0)
}
