declare module '@novnc/novnc' {
  type RfbOptions = {
    scaleViewport: boolean
    resizeSession: boolean
    viewOnly: boolean
  }

  export default class RFB implements RfbOptions {
    constructor(element: HTMLElement, url: string)
    scaleViewport: boolean
    resizeSession: boolean
    viewOnly: boolean
    disconnect(): void
  }
}
