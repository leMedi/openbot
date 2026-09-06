declare module '@novnc/novnc' {
  type RfbOptions = {
    scaleViewport: boolean
    resizeSession: boolean
    viewOnly: boolean
  }

  type RfbEventMap = {
    clipboard: CustomEvent<{ text: string }>
    connect: CustomEvent
    disconnect: CustomEvent<{ clean: boolean }>
    securityfailure: CustomEvent<{ reason?: string; status: number }>
  }

  export default class RFB implements RfbOptions {
    constructor(element: HTMLElement, url: string)
    scaleViewport: boolean
    resizeSession: boolean
    viewOnly: boolean
    clipboardPasteFrom(text: string): void
    focus(options?: FocusOptions): void
    sendKey(keysym: number, code: string, down?: boolean): void
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
