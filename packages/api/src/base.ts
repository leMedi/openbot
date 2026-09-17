import { ORPCError, os, ValidationError } from '@orpc/server'

export type ApiContext = {
  /** Incoming request headers; absent for in-process (SSR) calls. */
  headers?: Headers
}

/**
 * Every procedure starts here. The middleware surfaces the messages the UI
 * shows verbatim: the first validation issue for bad input, and the message
 * of any domain `Error` thrown below (single-user local server, nothing in
 * those messages is secret). Without it the client only sees "Internal
 * server error".
 */
export const base = os.$context<ApiContext>().use(async ({ next }) => {
  try {
    return await next()
  } catch (error) {
    if (error instanceof ORPCError) {
      if (error.code === 'BAD_REQUEST' && error.cause instanceof ValidationError) {
        const first = error.cause.issues[0]
        throw new ORPCError('BAD_REQUEST', {
          message: first?.message ?? error.message,
          data: error.cause.issues,
          cause: error.cause,
        })
      }
      throw error
    }
    if (error instanceof Error) {
      throw new ORPCError('INTERNAL_SERVER_ERROR', { message: error.message, cause: error })
    }
    throw error
  }
})

export function notFound(message: string): ORPCError<'NOT_FOUND', undefined> {
  return new ORPCError('NOT_FOUND', { message })
}

export function badRequest(message: string): ORPCError<'BAD_REQUEST', undefined> {
  return new ORPCError('BAD_REQUEST', { message })
}
