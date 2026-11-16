pluginManagement {
    repositories {
        google()
        mavenCentral()
        gradlePluginPortal()
    }
}
dependencyResolutionManagement {
    repositoriesMode.set(RepositoriesMode.FAIL_ON_PROJECT_REPOS)
    repositories {
        google()
        mavenCentral()
        // Hammerhead publishes karoo-ext only to GitHub Packages, which wants a token even for a
        // public package. JitPack builds the same public repo from its tag with no credentials,
        // and is allowed to serve that one group and nothing else.
        maven {
            url = uri("https://jitpack.io")
            content { includeGroup("com.github.hammerheadnav") }
        }
    }
}
rootProject.name = "SwoopAhead"
// app: the Karoo extension. The website and its service are in web/, and need no Gradle.
include(":app")
