export interface TransportStartResult {
  readonly port: number
  readonly token: string
  readonly url: string
}

export interface Transport {
  start(): Promise<TransportStartResult>
  stop(): Promise<void>
}
