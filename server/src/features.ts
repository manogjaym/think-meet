import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common'
import type { Request } from 'express'
import { ApiError } from './errors'
import { CONTRACT_REVISION, type CapabilitiesResponse } from './generated/contracts'
import { FEATURE_DEFINITIONS, featureForEvent, featureForHttp, isKnownEvent, isKnownHttpOperation } from './generated/feature-policy'
import { featureClient, featureDecision, mediaFeatureHeaders, socketFeatureClient, type ClientHeaders, type FeatureClient, type FeatureDefinition } from './feature-policy'

@Injectable()
export class FeaturePolicy {
  private readonly definitions = new Map<string, FeatureDefinition>(FEATURE_DEFINITIONS.map(feature => [feature.id, feature]))

  capabilities(headers: ClientHeaders): CapabilitiesResponse {
    const client = featureClient(headers)
    return { contractRevision: CONTRACT_REVISION, features: Object.fromEntries([...this.definitions.values()].map(feature => [feature.id, featureDecision(feature, client).available])) }
  }

  private assertFeature(id: string, client: FeatureClient) {
    const feature = this.definitions.get(id)
    const decision = feature ? featureDecision(feature, client) : { available: false, code: 'FEATURE_UNAVAILABLE' } as const
    if (decision.available) return
    if (decision.code === 'CLIENT_UPDATE_REQUIRED') throw new ApiError(decision.code, '이 기능을 사용하려면 최신 버전으로 업데이트해 주세요.', 426)
    throw new ApiError(decision.code, '현재 사용할 수 없는 기능입니다.', 409)
  }

  assertHttpFeature(id: string, headers: ClientHeaders) {
    this.assertFeature(id, featureClient(headers))
  }

  assertHttp(method: string, path: string, headers: ClientHeaders) {
    const verb = method.toUpperCase() === 'HEAD' ? 'GET' : method.toUpperCase()
    // A new client-facing handler must first be registered in the common contract.
    if (!isKnownHttpOperation(verb, path)) {
      if (/^\/api\/v1(?:\/|$)/.test(path)) throw new ApiError('FEATURE_UNAVAILABLE', '지원하지 않는 기능입니다.', 409)
      return
    }
    const feature = featureForHttp(verb, path)
    if (feature) this.assertHttpFeature(feature, headers)
  }

  assertEvent(event: string, payload: unknown, headers: ClientHeaders, auth?: unknown) {
    const message = payload !== null && typeof payload === 'object' && !Array.isArray(payload) ? payload as Record<string, unknown> : undefined
    if (!isKnownEvent(event, message)) throw new ApiError('FEATURE_UNAVAILABLE', '지원하지 않는 실시간 기능입니다.', 409)
    const feature = featureForEvent(event, message)
    if (feature) this.assertFeature(feature, socketFeatureClient(headers, auth))
  }
}

@Injectable()
export class HttpFeatureGuard implements CanActivate {
  constructor(private readonly features: FeaturePolicy) {}
  canActivate(context: ExecutionContext) {
    const req = context.switchToHttp().getRequest<Request>()
    const read = req.method === 'GET' || req.method === 'HEAD'
    this.features.assertHttp(req.method, req.path, read ? mediaFeatureHeaders(req.headers, req.query) : req.headers)
    return true
  }
}
