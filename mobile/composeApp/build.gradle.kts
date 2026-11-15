import org.jetbrains.kotlin.gradle.dsl.JvmTarget
import org.jetbrains.kotlin.gradle.tasks.KotlinCompilationTask

plugins {
    kotlin("multiplatform")
    kotlin("plugin.serialization")
    kotlin("plugin.compose")
    id("org.jetbrains.compose")
    id("com.android.application")
}

val designDirectory = rootProject.layout.projectDirectory.dir("../design")
val generatedCss = rootProject.layout.projectDirectory.file("../web/src/generated/design-tokens.css")
val generatedKotlin = layout.projectDirectory.file("src/commonMain/kotlin/com/woongjin/thinkmeet/design/generated/DesignTokens.kt")
// GUI IDEs may omit Homebrew from PATH. An explicit property always takes precedence.
val defaultDesignNode = listOf("/opt/homebrew/bin/node", "/usr/local/bin/node")
    .firstOrNull { file(it).canExecute() } ?: "node"
val nodeExecutable = providers.gradleProperty("designNodeExecutable").orElse(defaultDesignNode)

val generateDesignTokens by tasks.registering(Exec::class) {
    group = "design"
    description = "Generate shared web CSS and Compose design tokens from design/tokens.json."
    inputs.files(fileTree(designDirectory) { include("tokens.json", "web-aliases.json", "system.json", "assets/**", "fonts/**", "scripts/**/*.mjs") })
    outputs.files(generatedCss, generatedKotlin,
        rootProject.file("../web/src/generated/design-vectors.ts"),
        rootProject.file("../web/src/generated/design-content.ts"),
        rootProject.file("../web/src/generated/design-layout.json"),
        rootProject.file("../web/src/generated/design-palette.ts"),
        rootProject.file("../web/src/generated/design-fonts.css"),
        layout.projectDirectory.file("src/commonMain/kotlin/com/woongjin/thinkmeet/design/generated/DesignVectors.kt"),
        layout.projectDirectory.file("src/commonMain/kotlin/com/woongjin/thinkmeet/design/generated/DesignContent.kt"),
        layout.projectDirectory.file("src/commonMain/kotlin/com/woongjin/thinkmeet/design/generated/SharedFonts.kt"))
    outputs.dir(layout.projectDirectory.dir("src/commonMain/composeResources"))
    outputs.dir(rootProject.file("../web/public/design/fonts"))
    commandLine(nodeExecutable.get(), designDirectory.file("scripts/generate.mjs").asFile.absolutePath)
}

tasks.register<Exec>("checkDesignTokens") {
    group = "verification"
    description = "Fail on missing or stale generated design files without modifying them."
    commandLine(nodeExecutable.get(), designDirectory.file("scripts/generate.mjs").asFile.absolutePath, "--check")
}

tasks.withType<KotlinCompilationTask<*>>().configureEach { dependsOn(generateDesignTokens) }
tasks.matching { it.name == "copyNonXmlValueResourcesForCommonMain" || it.name == "convertXmlValueResourcesForCommonMain" }
    .configureEach { dependsOn(generateDesignTokens) }

val contractsDirectory = rootProject.layout.projectDirectory.dir("../contracts")
val contractNodeExecutable = providers.gradleProperty("contractNodeExecutable").orElse(nodeExecutable)
val generateContracts by tasks.registering(Exec::class) {
    group = "contracts"
    description = "Generate shared HTTP/Socket DTOs and feature metadata from contracts/ and features/."
    inputs.files(fileTree(contractsDirectory) { include("openapi.json", "realtime.json", "scripts/**/*.mjs") }, rootProject.file("../features/catalog.json"))
    outputs.files(
        layout.projectDirectory.file("src/commonMain/kotlin/com/woongjin/thinkmeet/data/generated/ContractModels.kt"),
        layout.projectDirectory.file("src/commonMain/kotlin/com/woongjin/thinkmeet/data/generated/ContractProtocol.kt"),
        rootProject.file("../web/src/generated/contracts.ts"), rootProject.file("../web/src/generated/feature-policy.ts"),
        rootProject.file("../server/src/generated/contracts.ts"), rootProject.file("../server/src/generated/feature-policy.ts"),
        rootProject.file("../server/src/generated/openapi-document.ts"),
    )
    commandLine(contractNodeExecutable.get(), contractsDirectory.file("scripts/generate.mjs").asFile.absolutePath)
}
val checkContracts by tasks.registering(Exec::class) {
    group = "verification"
    description = "Fail on stale generated HTTP/Socket contracts without changing files."
    commandLine(contractNodeExecutable.get(), contractsDirectory.file("scripts/generate.mjs").asFile.absolutePath, "--check")
}
// A verification build must observe stale checked-in output before compilation can regenerate it.
generateContracts.configure { mustRunAfter(checkContracts) }
tasks.withType<KotlinCompilationTask<*>>().configureEach { dependsOn(generateContracts) }
tasks.matching { it.name == "check" }.configureEach { dependsOn(checkContracts) }

kotlin {
    androidTarget { compilerOptions { jvmTarget.set(JvmTarget.JVM_17) } }
    iosArm64()
    iosSimulatorArm64()
    targets.withType<org.jetbrains.kotlin.gradle.plugin.mpp.KotlinNativeTarget>().configureEach {
        binaries.framework {
            baseName = "ThinkMeet"
            isStatic = true
            binaryOption("bundleId", "com.woongjin.thinkmeet.shared")
        }
    }
    sourceSets {
        commonMain.dependencies {
            implementation(compose.runtime)
            implementation(compose.foundation)
            implementation(compose.material3)
            implementation(compose.ui)
            implementation(compose.components.resources)
            implementation("org.jetbrains.kotlinx:kotlinx-coroutines-core:1.10.2")
            implementation("org.jetbrains.kotlinx:kotlinx-serialization-json:1.9.0")
            implementation("org.jetbrains.kotlinx:kotlinx-datetime:0.7.1")
            implementation("io.ktor:ktor-client-core:3.3.1")
            implementation("io.ktor:ktor-client-content-negotiation:3.3.1")
            implementation("io.ktor:ktor-serialization-kotlinx-json:3.3.1")
            implementation("io.ktor:ktor-client-websockets:3.3.1")
        }
        androidMain.dependencies {
            implementation("androidx.activity:activity-compose:1.10.1")
            implementation("io.ktor:ktor-client-okhttp:3.3.1")
            implementation("io.livekit:livekit-android:2.29.1")
            implementation("androidx.media3:media3-exoplayer:1.8.0")
            implementation("androidx.media3:media3-ui:1.8.0")
        }
        androidInstrumentedTest.dependencies {
            implementation("androidx.compose.ui:ui-test-junit4:1.10.5")
            implementation("androidx.test:runner:1.6.2")
            implementation("androidx.test:rules:1.6.1")
            implementation("androidx.test.ext:junit:1.2.1")
            implementation("androidx.test.uiautomator:uiautomator:2.3.0")
        }
        iosMain.dependencies { implementation("io.ktor:ktor-client-darwin:3.3.1") }
        commonTest.dependencies {
            implementation(kotlin("test"))
            implementation("io.ktor:ktor-client-mock:3.3.1")
            implementation("org.jetbrains.kotlinx:kotlinx-coroutines-test:1.10.2")
        }
    }
}

android {
    namespace = "com.woongjin.thinkmeet"
    compileSdk = 35
    defaultConfig {
        applicationId = "com.woongjin.thinkmeet"
        minSdk = 26
        targetSdk = 35
        versionCode = 1
        versionName = "1.0.0"
        testInstrumentationRunner = "androidx.test.runner.AndroidJUnitRunner"
    }
    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }
    buildTypes {
        release { isMinifyEnabled = true; proguardFiles(getDefaultProguardFile("proguard-android-optimize.txt"), "proguard-rules.pro") }
    }
    packaging { resources.excludes += "/META-INF/{AL2.0,LGPL2.1}" }
}
