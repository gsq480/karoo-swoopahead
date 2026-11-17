plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
}

android {
    namespace = "au.com.fjellconsulting.swoopahead"
    compileSdk = 35

    defaultConfig {
        applicationId = "au.com.fjellconsulting.swoopahead"
        // The Karoo 2 runs Android 8 (API 26), the Karoo 3 Android 12 (API 32).
        minSdk = 26
        targetSdk = 34
        versionCode = 3
        versionName = "0.1.2"
    }

    // The release key is kept outside the repo. Set SWOOPAHEAD_KEYSTORE to its path and
    // SWOOPAHEAD_KEYSTORE_PASSWORD to its password to build an APK that installs over the
    // published one. Without them the release build comes out unsigned.
    val keystore: String? = System.getenv("SWOOPAHEAD_KEYSTORE")
    signingConfigs {
        if (keystore != null) {
            create("release") {
                storeFile = file(keystore)
                storePassword = System.getenv("SWOOPAHEAD_KEYSTORE_PASSWORD")
                keyAlias = "swoopahead"
                keyPassword = System.getenv("SWOOPAHEAD_KEYSTORE_PASSWORD")
            }
        }
    }
    buildTypes {
        release {
            isMinifyEnabled = false
            signingConfig = signingConfigs.findByName("release")
        }
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }
    kotlinOptions {
        jvmTarget = "17"
    }
}

dependencies {
    // The Karoo SDK, Hammerhead's own 1.1.9 tag, built by JitPack (see settings.gradle.kts).
    implementation("com.github.hammerheadnav:karoo-ext:1.1.9")
    implementation("androidx.core:core-ktx:1.15.0")
    implementation("org.jetbrains.kotlinx:kotlinx-coroutines-android:1.9.0")
    // The warning rule and the rider's own marks are plain Kotlin, so their tests run on a
    // computer with no Karoo.
    testImplementation("junit:junit:4.13.2")
}
