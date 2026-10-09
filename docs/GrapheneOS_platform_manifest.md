---
curatedRepoId: grapheneos-platform-manifest
owner: GrapheneOS
repo: platform_manifest
revision: 0493b9e3a3ae90faf39bd7979a03df5e5dc63a0a
guideId: grapheneos-platform-manifest-guide
name: GrapheneOS Platform Manifest In The Mind
description: Understanding GrapheneOS through its Android 17 platform manifest
defaultOpenIds:
  - ch1
  - ch2
  - ch3
  - ch4
  - ch5
  - ch6
---

# GrapheneOS Platform Manifest In The Mind

> This guide reads GrapheneOS as a security-focused Android distribution whose source tree is assembled by a manifest.

GrapheneOS lives across a federated Android source tree. The platform manifest is the coordination layer that selects Android projects, GrapheneOS forks, release branches, and source-management policy. Read it before chasing individual patches.

---
id: ch1
title: Chapter 1 — The Manifest Defines the Product Boundary
fileRecommendations:
  readingOrder:
    - path: default.xml
      description: Main Android 17 manifest with remotes, project mappings, and selected revisions
      type: source
    - path: config.yml
      description: Repository metadata and automation configuration for the manifest tree
      type: source
---

Start with `default.xml`. The manifest explains which projects appear in a synced GrapheneOS checkout and where those projects come from. The remotes and revision choices are the first evidence for how the distribution relates to AOSP.

Read `config.yml` next because source selection is coupled to project automation. Together, these files show the product boundary: platform code, hardened forks, device support, and workflow metadata.

---
id: ch2
title: Chapter 2 — Security Work Is Visible as Source Selection
fileRecommendations:
  readingOrder:
    - path: default.xml
      description: Project choices that show where GrapheneOS tracks AOSP and where it carries forks
      type: source
    - path: GLOBAL-PREUPLOAD.cfg
      description: Repository-wide upload checks and contribution guardrails
      type: source
---

GrapheneOS hardening is not only found in implementation files. It also appears in the manifest through forked projects, branch choices, and review boundaries. A fork often marks a subsystem where privacy, exploit resistance, or device policy is part of the product.

`GLOBAL-PREUPLOAD.cfg` adds another layer: it shows what must be checked before changes enter the project set. Treat these checks as part of the source architecture because they constrain how code reaches the tree.

---
id: ch3
title: Chapter 3 — History and Licensing Explain Project Lineage
fileRecommendations:
  readingOrder:
    - path: COPPERHEAD-NOTICE
      description: Historical notice that explains inherited project context
      type: docs
    - path: default.xml
      description: Current project composition after that history
      type: source
---

Distribution source trees carry history. The notice file records inherited context, while the manifest records the current source graph. Reading both prevents a shallow interpretation of the repository as only a checkout recipe.

After the notice, return to `default.xml` and group projects by role: platform framework, hardware interfaces, build system, applications, device support, and vendor policy. That grouping turns a large Android checkout into a readable map.

---
id: ch4
title: Chapter 4 — Workflow Policy Is Part of the Source Architecture
fileRecommendations:
  readingOrder:
    - path: GLOBAL-PREUPLOAD.cfg
      description: Upload-time checks that protect repository consistency
      type: source
    - path: config.yml
      description: Project automation and repository metadata
      type: source
---

GrapheneOS should be read as code plus controls. `GLOBAL-PREUPLOAD.cfg` shows the checks that guard changes before they reach review, and `config.yml` records metadata used by project automation. These files explain how the tree stays consistent across separate repositories.

When a project emphasizes security, workflow files deserve the same attention as implementation files. They define what contributors can submit, how changes are checked, and which assumptions stay enforced across the source graph.

---
id: ch5
title: Chapter 5 — Compare the Distribution Choices
fileRecommendations:
  readingOrder:
    - path: default.xml
      description: GrapheneOS project selection for Android 17
      type: source
    - path: repo:LineageOS/android/default.xml
      description: LineageOS manifest for broader Android distribution comparison
      type: source
    - path: repo:ofdryads/miniageos/SOURCES.md
      description: miniageOS upstream attribution and downstream scope
      type: docs
---

Use related AOSP repositories to separate common Android structure from project-specific policy. [LineageOS](repo:LineageOS/android/default.xml) shows a broad community Android distribution. [miniageOS](repo:ofdryads/miniageos/SOURCES.md) shows a small downstream workflow that depends on LineageOS rather than maintaining a full platform manifest.

After reading those comparisons, return to GrapheneOS and ask which source choices are about platform completeness, which are about device support, and which are about privacy or exploit-resistance goals.

---
id: ch6
title: Chapter 6 — Build a Map Before Opening Subprojects
fileRecommendations:
  readingOrder:
    - path: default.xml
      description: Source graph for the synced Android workspace
      type: source
    - path: config.yml
      description: Automation context for the selected project set
      type: source
---

The synced workspace will be larger than this repository. Use `default.xml` as the index and write down the role of each project family before reading implementation code. This keeps framework, hardware, application, and device concerns separate.

When moving through GitShaman, use the AOSP switcher in the status bar to jump between GrapheneOS, LineageOS, and miniageOS. The comparison helps distinguish Android baseline structure from each project's product policy.
