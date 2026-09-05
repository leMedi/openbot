declare module '@novnc/novnc' {
  type RfbOptions = {
    scaleViewport: boolean
    resizeSession: boolean
    viewOnly: boolean
  }

  type RfbEventMap = {
    connect: CustomEvent
    disconnect: CustomEvent<{ clean: boolean }>
    securityfailure: CustomEvent<{ reason?: string; status: number }>
  }

  export default class RFB implements RfbOptions {
    constructor(element: HTMLElement, url: string)
    scaleViewport: boolean
    resizeSession: boolean
    viewOnly: boolean
    addEventListener<K extends keyof RfbEventMap>(
      type: K,
      callback: (this: RFB, event: RfbEventMap[K]) => void,
    ): void
    removeEventListener<K extends keyof RfbEventMap>(
      type: K,
      callback: (this: RFB, event: RfbEventMap[K]) => void,
    ): void
    disconnect(): void
  }
}
