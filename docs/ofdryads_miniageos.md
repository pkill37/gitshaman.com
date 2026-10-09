---
curatedRepoId: miniageos
owner: ofdryads
repo: miniageos
revision: b64d081c60bc6ea28447efdeed6cfcce5aabf1f0
guideId: miniageos-guide
name: miniageOS In The Mind
description: Understanding miniageOS as a LineageOS-based Pixel customization workflow
defaultOpenIds:
  - ch1
  - ch2
  - ch3
  - ch4
  - ch5
  - ch6
---

# miniageOS In The Mind

> This guide reads miniageOS as an Android customization workflow rather than as a full platform fork.

miniageOS starts from LineageOS and narrows the phone into a focused Pixel experience. Its repository is small, so the architecture is visible in scripts, configuration, replacement files, and source attribution.

---
id: ch1
title: Chapter 1 — The README Defines the Product
fileRecommendations:
  readingOrder:
    - path: README.md
      description: Project goals, supported workflow, and user-facing constraints
      type: docs
    - path: SOURCES.md
      description: Upstream sources and external components used by the project
      type: docs
---

Start with the product claim. `README.md` explains the intended phone experience, while `SOURCES.md` names the upstream material behind it. Together they define the boundary between original automation, LineageOS dependency, and third-party inputs.

That boundary matters because miniageOS is not trying to replace Android. It changes an existing Android distribution through repeatable setup and customization steps.

---
id: ch2
title: Chapter 2 — Configuration Separates Policy From Execution
fileRecommendations:
  readingOrder:
    - path: config-example.sh
      description: User-adjustable settings that parameterize the workflow
      type: source
    - path: sync-mod-build.sh
      description: Script that syncs source, applies modifications, and drives the build flow
      type: source
---

The configuration file is the policy surface. It names choices that should vary by user or device without editing the main workflow. The build script is the execution surface that turns those choices into a modified LineageOS tree.

Read variable names before reading shell control flow. That reveals which decisions the project expects users to make and which decisions are fixed by the workflow.

---
id: ch3
title: Chapter 3 — Flash-Time Customization Completes the System
fileRecommendations:
  readingOrder:
    - path: flash-customize.sh
      description: Flashing and post-build customization flow
      type: source
    - path: replace/
      description: Replacement payloads applied to the Android image or tree
      type: directory
---

miniageOS is completed at deployment time. `flash-customize.sh` shows how the built image reaches a device and where customization continues after the source build.

The `replace/` directory is the payload side of that flow. Read script and payload together: the script explains when changes happen, and the replacement files explain what changes happen.

---
id: ch4
title: Chapter 4 — Replacement Payloads Are the Product Delta
fileRecommendations:
  readingOrder:
    - path: replace/
      description: Files applied by the workflow to change the LineageOS-derived system
      type: directory
    - path: flash-customize.sh
      description: Deployment script that applies or coordinates customization
      type: source
---

The `replace/` directory is where the product becomes concrete. Treat every file there as a declared difference from the upstream Android or LineageOS experience. The script tells you when a replacement is used; the payload tells you what behavior or default changes.

This is the fastest way to understand miniageOS without reading every shell branch. Start with the payload names, then trace back to the command that installs them.

---
id: ch5
title: Chapter 5 — Compare Upstream and Sibling AOSP Projects
fileRecommendations:
  readingOrder:
    - path: SOURCES.md
      description: Upstream attribution for the miniageOS workflow
      type: docs
    - path: repo:LineageOS/android/README.mkdn
      description: LineageOS source checkout entry point
      type: docs
    - path: repo:GrapheneOS/platform_manifest/default.xml
      description: GrapheneOS manifest for a different Android distribution strategy
      type: source
---

miniageOS is easiest to read after comparing it with its upstream family. [LineageOS](repo:LineageOS/android/README.mkdn) provides the broad Android distribution base. [GrapheneOS](repo:GrapheneOS/platform_manifest/default.xml) provides a contrasting security-focused platform manifest. miniageOS sits downstream from that scale and focuses on workflow, configuration, and replacement payloads.

Use that comparison to avoid over-reading the repository. If a feature belongs to the Android platform, look upstream. If a choice belongs to the minimal Pixel product, expect it in configuration, scripts, or replacements.

---
id: ch6
title: Chapter 6 — Navigate by Lifecycle Stage
fileRecommendations:
  readingOrder:
    - path: README.md
      description: Overall lifecycle and user workflow
      type: docs
    - path: config-example.sh
      description: Setup-time decisions
      type: source
    - path: sync-mod-build.sh
      description: Source sync, modification, and build stage
      type: source
    - path: flash-customize.sh
      description: Flash and post-build customization stage
      type: source
---

Read miniageOS by lifecycle stage: understand the goal, set configuration, sync and patch LineageOS, build the image, then customize during flashing. That order follows the user's path and keeps script details connected to outcomes.

When moving between related repos in GitShaman, use the status bar AOSP switcher. Use miniageOS for the downstream workflow, LineageOS for the distribution base, and GrapheneOS for a manifest-centered hardening comparison.
