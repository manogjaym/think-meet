package com.woongjin.thinkmeet.data

import kotlin.time.Duration.Companion.milliseconds
import kotlin.time.TimeMark
import kotlin.time.TimeSource

internal const val CapabilityRefreshMillis = 120_000L

/** Server capability data is advisory; every mutation still relies on server authorization. */
enum class CapabilitySource { Baseline, Server, Unavailable }

@ConsistentCopyVisibility
data class FeatureCapabilities internal constructor(
    val contractRevision: Int?,
    val source: CapabilitySource,
    private val enabledFeatures: Set<String>,
    private val baselineFeatures: Set<String>,
    private val deniedBaselineFeatures: Set<String> = emptySet(),
    private val expiresAt: TimeMark? = null,
) {
    fun supports(feature: String): Boolean =
        ContractProtocol.isKnownFeature(feature) && feature in
            (if (expired()) baselineFeatures else enabledFeatures)

    internal fun expired(): Boolean = expiresAt?.hasPassedNow() == true
    internal fun baselineDenials(): Set<String> = deniedBaselineFeatures
    internal fun unavailable(platform: String): FeatureCapabilities = baseline(platform, unavailable = true, denied = deniedBaselineFeatures)

    internal companion object {
        fun baseline(platform: String, unavailable: Boolean = false, denied: Set<String> = emptySet()): FeatureCapabilities {
            val baseline = ContractProtocol.baselineFeatureIds(platform)
            val blocked = denied.intersect(baseline)
            val allowed = baseline - blocked
            return FeatureCapabilities(
                contractRevision = null,
                source = if (unavailable) CapabilitySource.Unavailable else CapabilitySource.Baseline,
                enabledFeatures = allowed,
                baselineFeatures = allowed,
                deniedBaselineFeatures = blocked,
            )
        }

        fun fromServer(response: CapabilitiesResponse, platform: String, previousDenials: Set<String> = emptySet()): FeatureCapabilities {
            val baseline = ContractProtocol.baselineFeatureIds(platform)
            val blocked = baseline.filterTo(mutableSetOf()) { id ->
                when (response.features[id]) {
                    true -> false
                    false -> true
                    null -> id in previousDenials
                }
            }
            return FeatureCapabilities(
                contractRevision = response.contractRevision,
                source = CapabilitySource.Server,
                enabledFeatures = response.features.asSequence()
                    .filter { (id, enabled) -> enabled && ContractProtocol.Features.any { feature ->
                        feature.id == id && platform in feature.platforms &&
                            feature.requiresRevision <= ContractProtocol.Revision &&
                            feature.requiresRevision <= response.contractRevision &&
                            feature.defaultEnabled && feature.stage != "planned"
                    } }
                    .map { it.key }.toSet(),
                baselineFeatures = baseline - blocked,
                deniedBaselineFeatures = blocked,
                expiresAt = TimeSource.Monotonic.markNow() + CapabilityRefreshMillis.milliseconds,
            )
        }
    }
}
