import { ArgumentsHost, Catch, ExceptionFilter, HttpException } from '@nestjs/common'
import { ZodError } from 'zod'
export class ApiError extends HttpException {
  constructor(code: string, message: string, status = 400) { super({ code, message }, status) }
}
@Catch()
export class Errors implements ExceptionFilter {
  catch(error: any, host: ArgumentsHost) {
    const response = host.switchToHttp().getResponse()
    if (response.headersSent) return response.end()
    if (error instanceof ZodError) return response.status(400).json({ code: 'VALIDATION', message: error.issues[0]?.message || '입력값을 확인해 주세요.' })
    if (error instanceof HttpException) {
      const body = error.getResponse()
      return response.status(error.getStatus()).json(typeof body === 'object' && body && 'code' in body ? body : { code: error.getStatus() === 413 ? 'FILE_TOO_LARGE' : 'REQUEST_FAILED', message: typeof body === 'object' && body && 'message' in body ? (body as any).message : body })
    }
    if (error?.code === 'P2002') return response.status(409).json({ code: 'CONFLICT', message: '이미 등록된 항목입니다.' })
    console.error('request failed', error?.name, error?.message)
    response.status(500).json({ code: 'INTERNAL', message: '요청을 처리하지 못했습니다. 잠시 후 다시 시도해 주세요.' })
  }
}
