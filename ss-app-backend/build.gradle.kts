val kotlin_version: String by project
val logback_version: String by project
val ktor_version: String by project
val supabase_version: String by project
val koin_version: String by project

plugins {
    kotlin("jvm") version "2.1.10"
    id("io.ktor.plugin") version "3.1.2"
    id("org.jetbrains.kotlin.plugin.serialization") version "2.1.10"
}

group = "com.sexyshop"
version = "0.0.1"

application {
    mainClass.set("com.sexyshop.ApplicationKt")
}

ktor {
    fatJar {
        archiveFileName.set("ss-app-backend.jar")
    }
}

repositories {
    mavenCentral()
}

dependencies {
    // Ktor Server
    implementation("io.ktor:ktor-server-core:$ktor_version")
    implementation("io.ktor:ktor-server-netty:$ktor_version")
    implementation("io.ktor:ktor-server-content-negotiation:$ktor_version")
    implementation("io.ktor:ktor-server-cors:$ktor_version")
    implementation("io.ktor:ktor-server-status-pages:$ktor_version")
    implementation("io.ktor:ktor-server-call-logging:$ktor_version")
    implementation("io.ktor:ktor-serialization-kotlinx-json:$ktor_version")

    // Supabase Kotlin SDK
    implementation("io.github.jan-tennert.supabase:postgrest-kt:$supabase_version")
    implementation("io.github.jan-tennert.supabase:storage-kt:$supabase_version")

    // Ktor Client (required by supabase-kt)
    implementation("io.ktor:ktor-client-cio:$ktor_version")

    // Koin DI
    implementation("io.insert-koin:koin-core:$koin_version")
    implementation("io.insert-koin:koin-ktor:$koin_version")
    implementation("io.insert-koin:koin-logger-slf4j:$koin_version")

    // Logging
    implementation("ch.qos.logback:logback-classic:$logback_version")

    // Testing
    testImplementation("io.ktor:ktor-server-test-host:$ktor_version")
    testImplementation("org.jetbrains.kotlin:kotlin-test-junit:$kotlin_version")
}
