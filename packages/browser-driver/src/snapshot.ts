export type SnapshotOptions = {
  interactive: boolean
  maxDepth: number
  selector?: string
}

export type SnapshotResult = {
  lines: string[]
  refCount: number
}

export const SNAPSHOT_FUNCTION = (options: SnapshotOptions): SnapshotResult => {
  const document = globalThis.document
  const window = globalThis.window
  const root = options.selector ? document.querySelector(options.selector) : document.body
  if (!root) return { lines: ['(no matching element for selector)'], refCount: 0 }

  const refs = new Map<string, Element>()
  ;(globalThis as typeof globalThis & { __openbotBrowserRefs?: Map<string, Element> }).__openbotBrowserRefs = refs
  let refCounter = 0
  const lines: string[] = []
  const maximumNodes = 400
  let nodeCount = 0
  const interactiveMatcher =
    'a[href], button, input, select, textarea, summary, ' +
    '[role="button"], [role="link"], [role="checkbox"], [role="radio"], ' +
    '[role="tab"], [role="menuitem"], [role="menuitemcheckbox"], [role="combobox"], ' +
    '[role="option"], [role="switch"], [role="searchbox"], [role="textbox"], ' +
    '[role="slider"], [contenteditable="true"], [onclick]'

  const visible = (element: HTMLElement) => {
    if (element.getAttribute('aria-hidden') === 'true') return false
    const style = window.getComputedStyle(element)
    if (style.display === 'none' || style.visibility === 'hidden') return false
    const rectangle = element.getBoundingClientRect()
    return rectangle.width > 0 && rectangle.height > 0
  }
  const trim = (text: string | null | undefined, maximum: number) => {
    const normalized = (text ?? '').replace(/\s+/g, ' ').trim()
    return normalized.length > maximum ? `${normalized.slice(0, maximum)}...` : normalized
  }
  const nameOf = (element: HTMLElement) => {
    const aria = element.getAttribute('aria-label')
    if (aria) return trim(aria, 80)
    if ('labels' in element) {
      const labels = (element as HTMLInputElement).labels
      if (labels && labels.length > 0) return trim((labels[0] as HTMLElement).innerText, 80)
    }
    for (const attribute of ['placeholder', 'alt', 'title']) {
      const value = element.getAttribute(attribute)
      if (value) return trim(value, 80)
    }
    const value = 'value' in element ? String((element as HTMLInputElement).value) : ''
    return trim(element.innerText || value, 80)
  }
  const roleOf = (element: HTMLElement) => {
    const explicit = element.getAttribute('role')
    if (explicit) return explicit
    const tag = element.tagName.toLowerCase()
    if (tag === 'a') return 'link'
    if (tag === 'button' || tag === 'summary') return 'button'
    if (tag === 'select') return 'combobox'
    if (tag === 'textarea') return 'textbox'
    if (tag === 'input') {
      const type = (element.getAttribute('type') ?? 'text').toLowerCase()
      if (type === 'button' || type === 'submit' || type === 'reset') return 'button'
      if (type === 'checkbox') return 'checkbox'
      if (type === 'radio') return 'radio'
      if (type === 'range') return 'slider'
      return 'textbox'
    }
    if (/^h[1-6]$/.test(tag)) return 'heading'
    return tag
  }
  const describe = (element: HTMLElement, depth: number) => {
    const role = roleOf(element)
    const name = nameOf(element)
    let line = `${'  '.repeat(Math.min(depth, 6))}- ${role}`
    if (name) line += ` ${JSON.stringify(name)}`
    const control = element as HTMLInputElement
    if (element.matches(interactiveMatcher) && !control.disabled) {
      refCounter += 1
      const ref = `e${String(refCounter)}`
      refs.set(ref, element)
      line += ` [ref=${ref}]`
    }
    if (control.disabled) line += ' disabled'
    if (control.checked === true) line += ' checked'
    const tag = element.tagName.toLowerCase()
    if ((tag === 'input' || tag === 'textarea') && control.value.length > 0) {
      const inputType = (element.getAttribute('type') ?? '').toLowerCase()
      const autocomplete = element.getAttribute('autocomplete')
      const secret =
        inputType === 'password' ||
        autocomplete === 'current-password' ||
        autocomplete === 'new-password'
      line += ` value=${secret ? '"<redacted>"' : JSON.stringify(trim(control.value, 40))}`
    }
    if (tag === 'a') {
      const href = element.getAttribute('href')
      if (href && !href.startsWith('javascript:')) line += ` href=${JSON.stringify(trim(href, 80))}`
    }
    return line
  }
  const walk = (element: Element, depth: number) => {
    if (nodeCount >= maximumNodes || depth > (options.maxDepth ?? 20)) return
    if (!(element instanceof window.HTMLElement)) return
    const tag = element.tagName.toLowerCase()
    if (tag === 'script' || tag === 'style' || tag === 'noscript' || !visible(element)) return
    const interactive = element.matches(interactiveMatcher)
    const heading = /^h[1-6]$/.test(tag)
    const textual =
      !options.interactive && ['p', 'li', 'label', 'td', 'th'].includes(tag)
    let childDepth = depth
    if (
      interactive ||
      heading ||
      (textual && trim(element.innerText, 10).length > 0 && !element.querySelector(interactiveMatcher))
    ) {
      nodeCount += 1
      lines.push(describe(element, depth))
      childDepth = depth + 1
      if (interactive || textual) return
    }
    for (const child of element.children) walk(child, childDepth)
  }

  walk(root, 0)
  if (nodeCount >= maximumNodes) lines.push(`(snapshot truncated at ${String(maximumNodes)} elements)`)
  return { lines, refCount: refCounter }
}
