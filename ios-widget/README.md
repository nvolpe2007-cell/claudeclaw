# Nudge — iOS Lock-Screen Widget

A lock-screen widget that shows a random **nudge**: a small, harmless
challenge that gently defies an everyday social norm ("order a soda in a
water cup," "ask a stranger to grab food"). It ships with ~40 built-in
nudges, works **offline**, and needs **no backend**.

This folder contains the Swift source. You assemble it into an Xcode project
on a Mac (iOS apps can only be built on macOS with Xcode). The steps below
take about 10 minutes.

---

## What you need

- A **Mac** with **Xcode 15+** (free from the Mac App Store).
- To run it on your **own iPhone**: a free Apple ID is enough.
- To share it with others / ship to the App Store: a paid **Apple Developer
  account** ($99/yr). Not needed to try it yourself.
- iPhone on **iOS 16+** (lock-screen widgets require iOS 16; this project
  targets iOS 17 for `containerBackground`).

---

## The files

```
ios-widget/
├── App/
│   ├── NudgeApp.swift          # host app entry point
│   └── ContentView.swift       # the app's single screen + widget instructions
├── Shared/
│   └── Tasks.swift             # the bundled list of nudges  ← add to BOTH targets
└── Widget/
    ├── NudgeWidgetBundle.swift # widget extension entry point (@main)
    ├── TaskProvider.swift      # picks a nudge, sets the refresh schedule
    ├── TaskWidgetView.swift    # the lock-screen card UI
    └── TaskWidget.swift        # widget config + supported sizes
```

---

## Setup (manual Xcode path — reliable)

### 1. Create the app project
1. Open Xcode → **File ▸ New ▸ Project… ▸ iOS ▸ App**.
2. Product Name: **Nudge**. Interface: **SwiftUI**. Language: **Swift**.
3. Save it anywhere (e.g. next to this folder).

### 2. Add the widget extension
1. **File ▸ New ▸ Target… ▸ iOS ▸ Widget Extension**.
2. Name it **NudgeWidget**. **Uncheck** "Include Configuration App Intent"
   (this widget isn't user-configurable yet).
3. When prompted to activate the scheme, click **Activate**.

Xcode now generates a correct project with two targets — the app and the
widget extension — wired together. That's the part that's painful to write
by hand, which is why we let Xcode do it.

### 3. Drop in the source files
Replace Xcode's generated stubs with the files from this folder:

- **App target** → use `App/NudgeApp.swift` and `App/ContentView.swift`
  (replace the auto-generated `NudgeApp.swift` / `ContentView.swift`).
- **Widget target** → delete the generated `NudgeWidget.swift` bundle stub,
  then add `Widget/NudgeWidgetBundle.swift`, `Widget/TaskProvider.swift`,
  `Widget/TaskWidgetView.swift`, and `Widget/TaskWidget.swift`.
- **`Shared/Tasks.swift`** → add it and, in the File Inspector on the right,
  check **BOTH** "Target Membership" boxes (Nudge **and** NudgeWidget). Both
  the app and the widget read the same task list, so both need the file.

> Only one file in the widget target may have `@main`. That's
> `NudgeWidgetBundle.swift`. If Xcode's generated stub still has `@main`,
> delete it — otherwise you'll get a "multiple @main" build error.

### 4. Allow the widget to deep-link into the app (optional but recommended)
So tapping the widget opens the app:
1. Select the **Nudge** app target ▸ **Info** tab ▸ **URL Types** ▸ **+**.
2. Set **URL Schemes** to `nudge`. (Matches `nudge://open` in the widget.)

### 5. Run it
1. Pick your iPhone (or a simulator) as the run destination.
2. Press **▶︎**. The host app launches.
3. Add the widget: **lock the phone → touch and hold the lock screen →
   Customize → Lock Screen → tap the widget row → choose "Nudge."**
   (On the Home Screen: long-press ▸ **+** ▸ search "Nudge.")

You'll see a nudge on your lock screen. It rotates on iOS's schedule (see
below).

---

## How refreshing works

iOS controls how often widgets update — you can't force "a new task every
glance." `TaskProvider` hands iOS a schedule of upcoming nudges (one per
hour for the next 6 hours) and asks for a fresh schedule when it runs out.
In practice the nudge changes several times a day. This keeps every refresh
instant and free since the tasks are bundled in the app.

---

## Customizing

- **Add or edit nudges** → `Shared/Tasks.swift`. Keep the curation rule:
  harmless, legal, kind. Awkward is good; risky or unkind is not.
- **Change how often it rotates** → the `0..<6` loop / `.hour` step in
  `TaskProvider.getTimeline`.
- **Restyle the card** → `TaskWidgetView.swift`.

---

## Where this goes next (from the overall plan)

This is **phase 1**: a self-contained widget with a bundled list. Phase 2
connects it to a shared backend so the widget and the web **feed** (where
people post photo + caption proof of completed nudges) draw from the same
task list. When that exists, `TaskProvider` swaps its `Tasks.random()` call
for a fetch from `GET /api/task/random` — everything else stays the same.
