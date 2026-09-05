export type Coordinate = { x: number; y: number }

export type MouseButton =
  | 'MOUSE_BUTTON_UNSPECIFIED'
  | 'MOUSE_BUTTON_LEFT'
  | 'MOUSE_BUTTON_RIGHT'
  | 'MOUSE_BUTTON_MIDDLE'
  | 'MOUSE_BUTTON_BACK'
  | 'MOUSE_BUTTON_FORWARD'

export type ScrollDirection =
  | 'SCROLL_DIRECTION_UNSPECIFIED'
  | 'SCROLL_DIRECTION_UP'
  | 'SCROLL_DIRECTION_DOWN'
  | 'SCROLL_DIRECTION_LEFT'
  | 'SCROLL_DIRECTION_RIGHT'

export type ComputerUseAction =
  | { mouse_move: { coordinate: Coordinate } }
  | {
      click: {
        coordinate?: Coordinate
        button: MouseButton
        count: number
        modifier_keys?: string
      }
    }
  | { mouse_down: { button: MouseButton } }
  | { mouse_up: { button: MouseButton } }
  | {
      drag: {
        path: Coordinate[]
        button: MouseButton
        modifier_keys?: string
      }
    }
  | {
      scroll: {
        coordinate?: Coordinate
        direction: ScrollDirection
        amount: number
        modifier_keys?: string
      }
    }
  | { type: { text: string } }
  | { key: { key: string; hold_duration_ms?: number } }
  | { wait: { duration_ms: number } }
  | { screenshot: Record<string, never> }
  | { cursor_position: Record<string, never> }

export type ComputerUseArgs = {
  tool_call_id: string
  actions: ComputerUseAction[]
  description?: string
  bind_unmapped_characters?: boolean
}

export type ExecServerMessage = {
  id: number
  exec_id: string
  computer_use_args: ComputerUseArgs
  span_context?: Record<string, unknown>
  accept_hook_additional_contexts?: boolean
}

export type ComputerUseSuccess = {
  action_count: number
  duration_ms: number
  /** Base64 text containing WebP bytes. */
  screenshot?: string
  log?: string
  screenshot_path?: string
  cursor_position?: Coordinate
}

export type ComputerUseError = {
  error: string
  error_code?: 'DESKTOP_UNAVAILABLE' | 'DRIVER_FAILURE'
  action_count: number
  duration_ms: number
  log?: string
  /** Base64 text containing WebP bytes. */
  screenshot?: string
  screenshot_path?: string
  cursor_position?: Coordinate
}

export type ComputerUseResult =
  | { success: ComputerUseSuccess }
  | { error: ComputerUseError }

export type ExecClientMessage = {
  id: number
  exec_id: string
  local_execution_time_ms?: number
  computer_use_result: ComputerUseResult
}

export type ExecClientControlMessage =
  | { stream_close: { id: number } }
  | {
      throw: {
        id: number
        error: string
        stack_trace?: string
        error_code?: string
      }
    }
  | { heartbeat: { id: number } }

export type ExecStreamElement =
  | { exec_client_message: ExecClientMessage }
  | { exec_client_control_message: ExecClientControlMessage }

export const DESKTOP_WIDTH = 1280
export const DESKTOP_HEIGHT = 800
