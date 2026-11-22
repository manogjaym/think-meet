import { ArgumentsHost, Catch, ExceptionFilter, HttpException } from '@nestjs/common'
import { ZodError } from 'zod'
import type { ErrorCode } from './generated/contracts'
export type { ErrorCode }
/** Only codes listed in contracts/openapi.json ErrorCode compile, so clients can match them exactly. */
export class ApiError extends HttpException {
  constructor(code: ErrorCode, message: string, status = 400) { super({ code, message }, status) }
}
export type ErrorBody = { code: ErrorCode; message: string }

/** One mapping for HTTP responses and Socket acks; Socket callers only drop the status. */
export function toErrorBody(error: unknown): { status: number; body: ErrorBody } {
  if (error instanceof ZodError) return { status: 400, body: { code: 'VALIDATION', message: error.issues[0]?.message || '입력값을 확인해 주세요.' } }
  if (error instanceof HttpException) {
    const body = error.getResponse()
    if (typeof body === 'object' && body && 'code' in body) return { status: error.getStatus(), body: body as ErrorBody }
    const message = typeof body === 'object' && body && 'message' in body ? (body as { message: unknown }).message : body
    return { status: error.getStatus(), body: { code: error.getStatus() === 413 ? 'FILE_TOO_LARGE' : 'REQUEST_FAILED', message: Array.isArray(message) ? message.join(' ') : String(message) } }
  }
  if ((error as { code?: unknown })?.code === 'P2002') return { status: 409, body: { code: 'CONFLICT', message: '이미 등록된 항목입니다.' } }
  console.error('request failed', (error as Error)?.name, (error as Error)?.message)
  return { status: 500, body: { code: 'INTERNAL', message: '요청을 처리하지 못했습니다. 잠시 후 다시 시도해 주세요.' } }
}

@Catch()
export class Errors implements ExceptionFilter {
  catch(error: unknown, host: ArgumentsHost) {
    const response = host.switchToHttp().getResponse()
    if (response.headersSent) return response.end()
    const { status, body } = toErrorBody(error)
    response.status(status).json(body)
  }
}
