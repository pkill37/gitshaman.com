---
curatedRepoId: lineageos-android
owner: LineageOS
repo: android
revision: 2a50ca061bffe4e73918ae2e0b99b7a05f647154
guideId: lineageos-android-guide
name: LineageOS Android Manifest In The Mind
description: Understanding LineageOS through its Android 17-era repo manifest
defaultOpenIds:
  - ch1
  - ch2
  - ch3
  - ch4
  - ch5
  - ch6
---

# LineageOS Android Manifest In The Mind

> This guide reads LineageOS from the manifest outward. The manifest is not the operating system, but it maps which Android projects become the operating system.

LineageOS is a full Android distribution spread across a federated Git source tree. This repository is the control plane for that distribution. Start here to learn which projects are inherited from AOSP, which projects are replaced by LineageOS forks, and which local manifest fragments complete the source checkout.

---
id: ch1
title: Chapter 1 — The Manifest Is the Source Tree Boundary
fileRecommendations:
  readingOrder:
    - path: README.mkdn
      description: Repo setup, checkout commands, and project context
      type: docs
    - path: default.xml
      description: Main manifest defining remotes, default branch policy, and project list
      type: source
---

Treat `default.xml` as the root of the LineageOS source tree. The file lists projects that later appear as directories in a synced Android workspace. The important lesson is that the platform is composed rather than stored in a single repository.

Read the remote definitions first, then read the default revision, then scan project entries. That order reveals which code comes from upstream Android, which code comes from LineageOS, and how branch naming keeps a release train coherent.

---
id: ch2
title: Chapter 2 — Forks Show Distribution Policy
fileRecommendations:
  readingOrder:
    - path: default.xml
      description: Project entries where LineageOS substitutes or tracks Android components
      type: source
    - path: snippets/
      description: Manifest fragments that layer extra source selections onto the main manifest
      type: directory
---

LineageOS policy appears through project selection. A project entry acts as both download instruction and statement about ownership, patch flow, and release integration.

When a project points at a LineageOS remote, expect distribution-specific behavior or integration work. When it points elsewhere, ask why the upstream source fits this release. This distinction is the fastest path to finding where LineageOS diverges from base Android.

---
id: ch3
title: Chapter 3 — Device Support Is Composed Around the Platform
fileRecommendations:
  readingOrder:
    - path: default.xml
      description: Platform, build, vendor, hardware, and toolchain projects used by the checkout
      type: source
    - path: README.mkdn
      description: Entry point for syncing and building the manifest into a workspace
      type: docs
---

Android distributions are platform trees plus device-specific layers. This manifest gives the platform side of that equation. Device trees, kernels, and vendor projects join that platform during a full checkout.

Use the manifest to answer three questions before reading implementation code: which branch anchors the release, which remotes supply platform projects, and which directories will exist after sync. Those answers make later source navigation tractable.

---
id: ch4
title: Chapter 4 — Snippets Are the Local Overlay Mechanism
fileRecommendations:
  readingOrder:
    - path: snippets/
      description: Manifest overlay fragments that extend or replace the base project list
      type: directory
    - path: default.xml
      description: Base manifest that the snippets refine
      type: source
---

Read `snippets/` as the place where the source graph becomes modular. The main manifest gives the shared checkout, while snippets let the project add optional or product-specific project selections without turning `default.xml` into a single unbounded file.

The pattern to learn is base first, overlay second. If a project appears surprising, check whether a snippet introduces it, the base manifest inherits it, or a repo command outside this repository selects it.

---
id: ch5
title: Chapter 5 — Compare AOSP Relatives Before Reading Patches
fileRecommendations:
  readingOrder:
    - path: default.xml
      description: LineageOS project selection for the Android 17-era checkout
      type: source
    - path: repo:GrapheneOS/platform_manifest/default.xml
      description: GrapheneOS Android 17 manifest for a security-focused comparison
      type: source
    - path: repo:ofdryads/miniageos/README.md
      description: miniageOS product goal built on top of LineageOS
      type: docs
---

Use the AOSP family as a comparison set. [GrapheneOS](repo:GrapheneOS/platform_manifest/default.xml) answers a security-hardening question: which Android projects need forks or workflow policy? [miniageOS](repo:ofdryads/miniageos/README.md) answers a product-scope question: how can a LineageOS base be narrowed for a minimal Pixel experience?

Return to LineageOS after that comparison and group project entries by purpose: platform, build, apps, hardware, vendor, tools, and device support. The groups make a long manifest readable.

---
id: ch6
title: Chapter 6 — Use the Manifest as a Navigation Index
fileRecommendations:
  readingOrder:
    - path: README.mkdn
      description: Commands that turn this repository into a synced workspace
      type: docs
    - path: default.xml
      description: Directory map for the eventual Android source checkout
      type: source
---

The best practical habit is to treat every manifest project as a future directory. Before opening implementation code in a full checkout, search `default.xml` for the directory name, remote, and revision. That reveals ownership before details.

When moving between AOSP-family repos in GitShaman, use the status bar AOSP switcher. Use LineageOS for the broad Android distribution map, GrapheneOS for hardening-oriented source selection, and miniageOS for a compact downstream customization workflow.
