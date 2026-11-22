import 'reflect-metadata'
import { Module } from '@nestjs/common'
import { APP_GUARD, NestFactory } from '@nestjs/core'
import { SwaggerModule, type OpenAPIObject } from '@nestjs/swagger'
import express from 'express'
import { Auth, Database } from './auth'
import { Lessons } from './lessons'
import { LiveKitAdapter } from './lesson/livekit'
import { LessonRealtime } from './realtime-port'
import { Materials } from './materials'
import { Gateway } from './gateway'
import { AuthGuard, CONTROLLERS, TeacherUploadGuard } from './http'
import { Errors } from './errors'
import { ClassNotes } from './class-notes'
import { StudentAttendance } from './student-attendance'
import { FeaturePolicy, HttpFeatureGuard } from './features'
import { OPENAPI_DOCUMENT } from './generated/openapi-document'
// Global guards run in this order: session first (401), then the contract feature gate.
@Module({ controllers: CONTROLLERS, providers: [Database, Auth, LiveKitAdapter, LessonRealtime, Lessons, Materials, ClassNotes, StudentAttendance, Gateway, TeacherUploadGuard, FeaturePolicy, { provide: APP_GUARD, useClass: AuthGuard }, { provide: APP_GUARD, useClass: HttpFeatureGuard }] })
export class AppModule {}
async function bootstrap() {
  for (const key of ['DATABASE_URL','LIVEKIT_API_KEY','LIVEKIT_API_SECRET','S3_ENDPOINT','S3_ACCESS_KEY','S3_SECRET_KEY','PROXY_AUTH_SECRET','PUBLIC_ORIGIN']) if (!process.env[key]) throw new Error(`${key} is required`)
  const app = await NestFactory.create(AppModule, { rawBody: true, bodyParser: false })
  app.use(express.json({ limit: '1mb', type: ['application/json','application/webhook+json'], verify: (req: any, _res, body) => { req.rawBody = body } }))
  app.use((req: express.Request, res: express.Response, next: express.NextFunction) => {
    res.setHeader('X-Content-Type-Options', 'nosniff')
    res.setHeader('Cache-Control', 'no-store')
    if (!['GET','HEAD','OPTIONS'].includes(req.method) && req.path !== '/api/v1/webhooks/livekit') {
      const origin = req.headers.origin
      const allowed = [process.env.PUBLIC_ORIGIN, 'https://localhost', 'https://127.0.0.1', ...(process.env.DEV_ORIGINS || 'http://localhost:8443,http://127.0.0.1:8443').split(',')]
      if (origin && !allowed.includes(origin)) return res.status(403).json({ code: 'FORBIDDEN', message: '허용되지 않은 요청 주소입니다.' })
    }
    next()
  })
  app.useGlobalFilters(new Errors())
  const document = structuredClone(OPENAPI_DOCUMENT) as unknown as OpenAPIObject
  SwaggerModule.setup('api/docs', app, document, { jsonDocumentUrl: 'api/openapi.json' })
  app.enableShutdownHooks()
  await app.listen(Number(process.env.PORT || 3000), '0.0.0.0')
}
if (require.main === module) bootstrap().catch(error => { console.error(error.message); process.exitCode = 1 })
