import { Controller, Get, Headers, Post, Req } from '@nestjs/common'
import { ApiOperation, ApiTags } from '@nestjs/swagger'
import type { Request } from 'express'
import { Database } from '../auth'
import { ApiError } from '../errors'
import { FeaturePolicy } from '../features'
import { Lessons } from '../lessons'
import { Materials } from '../materials'
import type { CapabilitiesResponse } from '../generated/contracts'
import { Public } from './auth-guard'

@ApiTags('service')
@Controller('api/v1')
@Public()
export class SystemController {
  constructor(readonly db: Database, readonly lessons: Lessons, readonly materials: Materials, readonly features: FeaturePolicy) {}
  @Get('capabilities')
  capabilities(@Req() req: Request): CapabilitiesResponse { return this.features.capabilities(req.headers) }
  @Get('health')
  @ApiOperation({ summary: 'PostgreSQL, MinIO, LiveKit readiness' })
  async health() {
    try { await this.db.$queryRaw`SELECT 1`; await this.materials.ready(); await this.lessons.livekit.listRooms(); return { status: 'ok', database: true, storage: true, livekit: true } } catch { throw new ApiError('NOT_READY', '서비스를 준비하고 있습니다.', 503) }
  }
  /** Verified by the LiveKit webhook signature, not a session. */
  @Post('webhooks/livekit')
  webhook(@Req() req: Request & { rawBody?: Buffer }, @Headers('authorization') authorization: string) { return this.lessons.webhook(req.rawBody?.toString('utf8') || '', authorization) }
}

/** Private proxy hook; verified by the proxy secret and the LiveKit admission token. */
@Controller('internal')
@Public()
export class InternalController {
  constructor(readonly lessons: Lessons) {}
  @Get('livekit-auth') auth(@Headers('x-forwarded-uri') uri: string, @Headers('x-proxy-secret') secret: string, @Headers('authorization') authorization?: string) { return this.lessons.authorizeLivekit(uri || '', secret || '', authorization) }
}
