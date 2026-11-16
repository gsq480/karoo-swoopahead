# Swoop Ahead

A Hammerhead Karoo extension that warns you before a magpie swooping spot, and a shared map of
those spots that riders fill by tapping. Free, with no account.

- **The map and the way to report a swoop:** https://swoopahead.pages.dev
- **This repo:** the Karoo extension in `app/`, and the website and its service in `web/`.

This is version 0.1.0, a beta. Magpies swoop from about August to November, so outside those
months nothing warns.

## What it does on a ride

- About 250 m before a known spot, the Karoo shows **Magpie ahead** with the distance, the spot's
  name and the date of its last report, and plays three rising beeps.
- The **Magpie** field shows the distance to the nearest spot. It reads CLEAR past 2 km and turns
  orange inside the warn distance.
- Tap the field, or map the **Mark a swoop** action to a button, when a magpie swoops you. The
  Karoo shows **Swoop marked**.
- Spots show as caution pins on the Karoo's map.

It warns once per pass, never while you ride away from a spot, and only while a ride is
recording. The check runs on the Karoo against its own copy of the spots, so it needs no phone
link at the moment it warns.

## Install

**On a Karoo 3:**

1. On your phone, open the [latest release](https://github.com/gsq480/karoo-swoopahead/releases/latest).
2. Press and hold `swoopahead.apk`, choose **Share**, then the Hammerhead app.
3. On the Karoo, tap **Install**.

**On a Karoo 2:** download `swoopahead.apk` and run `adb install swoopahead.apk` over a cable.

Then add the field to a ride page: **Profiles**, your profile, **Data Pages**, a page, **Add
Field**, **SWOOP AHEAD**, **Magpie**. The warning works without the field on a page. The field
is how you mark a swoop.

To update, press and hold the app's icon on the Karoo and tap **Update**.

## What it sends

- **When you mark a swoop:** its place, the time, your direction of travel, and a random id made
  once for your Karoo. The id lets the map tell one device sending junk from many riders
  reporting one bird. It names nobody and is never shown publicly.
- **To fetch the spots near you:** your position rounded to a tenth of a degree, about 10 km.
- **Nothing else.** No name, no account, no ride.

Turn off **Send my marks to the shared map** on the app's screen and your marks stay on your
Karoo. You are still warned for them.

The service counts reports per hour from one network address to slow misuse down. It keeps that
count against a scrambled form of the address, which changes daily and is deleted after a day.

## Settings

On the app's screen on the Karoo:

- How far out the warning comes: 150, 250 or 400 m.
- The beep, on or off.
- Sending your marks to the shared map, on or off.
- **Sync now**, **Test the warning** and **Remove my last mark**.

## Where the spots come from

- Riders' taps, and reports made on the website.
- In Victoria, the Victorian Government's "Map of Victoria with locations of swooping birds
  populated by the public" (Department of Energy, Environment and Climate Action), used under
  Creative Commons Attribution 4.0. Magpie records only.

Reports within 150 m of each other are one spot. A spot stays on the map for two seasons after
its last report.

## What it doesn't do well

- The map is only as good as its reports. Where nobody has reported, nothing warns.
- Anyone can report, so a spot can be wrong. Wrong spots get removed. Tell us on the website.
- It works on a Karoo. There is no phone app.

## Build it yourself

### The extension (`app/`)

You need JDK 17 and the Android SDK.

```
./gradlew :app:testDebugUnitTest
./gradlew :app:assembleDebug
adb install -r app/build/outputs/apk/debug/app-debug.apk
```

A debug build won't install over the published app, because the published app is signed with a
different key. Uninstall that first.

The warning rule is `app/.../swoop/Swoop.kt` and the rider's own marks are `Marks.kt`. Both are
plain Kotlin with tests. Desk checks over a cable:

```
adb shell am start -n au.com.fjellconsulting.swoopahead/.SettingsActivity --activity-clear-top --ez demo true   # show the warning
adb shell am start -n au.com.fjellconsulting.swoopahead/.SettingsActivity --activity-clear-top --ez sync true   # ask the shared map now
adb shell am start -n au.com.fjellconsulting.swoopahead/.SettingsActivity --activity-clear-top --ez mark true   # mark a swoop where the Karoo is
adb logcat -s SwoopAhead
```

### The website and service (`web/`)

A Cloudflare Pages project: the site in `web/public/`, the service in `web/functions/`, and a D1
database. It needs `wrangler` and nothing else.

```
node web/tools/check.mjs                                   # the rules and the storage, 60 checks
cd web
wrangler d1 execute swoopahead --local --file=schema.sql   # make the local database
wrangler pages dev --d1 DB=<the database_id in wrangler.toml>
```

Put `ADMIN_PASSPHRASE=something` in `web/.dev.vars` to use the admin page at `/admin` locally.

The rules (what joins a spot, what is live, what a stranger's report must pass) are in
`web/lib/swoop-core.ts`. The routes:

- `GET /api/spots?lat=&lng=` the live spots nearest a position, for a Karoo.
- `GET /api/map` every spot for the website's map.
- `POST /api/reports` a swoop, from a Karoo or the website.
- `/api/admin/*` needs the passphrase: remove, quiet, rename or add a spot, and the settings.

## Credits and licence

Swoop Ahead is released under the Apache License 2.0. See `LICENSE`.

The on-device distance check and alert follow the pattern of
[`anpaiss/PoiAhead`](https://github.com/anpaiss/PoiAhead) (MIT). The Karoo SDK is Hammerhead's
`karoo-ext` (Apache-2.0). The website's map is drawn with MapLibre on OpenFreeMap tiles, from
OpenStreetMap data.

Swoop Ahead is not made or endorsed by Hammerhead, SRAM or Magpie Alert.
