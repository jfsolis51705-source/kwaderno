plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
}

android {
    namespace = "ph.kwaderno.payalert"
    compileSdk = 35

    defaultConfig {
        applicationId = "ph.kwaderno.payalert"
        minSdk = 26
        targetSdk = 35
        versionCode = 1
        versionName = "0.1.0-pilot"
    }

    buildTypes {
        release {
            isMinifyEnabled = false
            // Pilot builds are signed with the debug key; set up a real release key before Google Play.
            signingConfig = signingConfigs.getByName("debug")
        }
    }
    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }
    kotlinOptions { jvmTarget = "17" }
}

dependencies {
    testImplementation("junit:junit:4.13.2")
}
