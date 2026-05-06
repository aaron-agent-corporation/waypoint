export interface IEventBus {
  publish(event: {
    type: string
    timestamp: number
    payload?: unknown
  }): Promise<void> | void
}
