---
curatedRepoId: nextbsd-kernel
owner: nextbsd-redux
repo: nextbsd-kernel
revision: dcfa0cda0600d7ecce6216adcc7d8b31982ef702
guideId: nextbsd-kernel-guide
name: NextBSD Kernel In The Mind
description: Understanding NextBSD as a kernel patch and configuration layer
defaultOpenIds:
  - ch1
  - ch2
  - ch3
  - ch4
---

# NextBSD Kernel In The Mind

NextBSD's kernel repository is not a full forked `src` tree. The repository provides a patch, overlay, configuration, and CI layer on top of a FreeBSD kernel source base. Read it as a record of intentional differences.

The right mental model is "delta literacy." Every file in this repository should answer one of four questions: what patch changes upstream behavior, what config turns behavior on, what overlay supplies source or config fragments, and what workflow applies the delta to a prepared FreeBSD tree.

---
id: ch1
title: Chapter 1 — Patch Layer, Not Fork
fileRecommendations:
  readingOrder:
    - path: README.md
      description: Repository purpose, layout, and build workflow
      type: docs
    - path: patches/README.md
      description: Patch workflow and contribution rules
      type: docs
    - path: patches/series
      description: Ordered patch list applied to the FreeBSD kernel base
      type: source
    - path: config/NEXTBSD
      description: Kernel configuration used for NextBSD builds
      type: source
---

The most important design choice is that NextBSD records kernel changes as patches and overlays rather than carrying a full rewritten source import. `patches/series` is the table of contents for kernel behavior changes.

This style makes the delta legible. Each patch can explain the upstream context, the local policy, and the risk of divergence. `config/NEXTBSD` then shows how the resulting kernel is built into a named configuration.

Start with `patches/series` before opening individual patches. The order is part of the design: the first patches reserve kernel interface surface, middle patches adjust compatibility and filesystem behavior, and later patches encode desktop policy. Then read `patches/README.md` to understand why the repository carries format-patch files instead of a vendored FreeBSD tree.

When you open a patch, read it in three layers. The subject and commit message explain intent; the file list shows the affected subsystem; the hunk shows the actual kernel contract being changed. Small patches such as the vfs.usermount default are ideal teaching material because the behavioral consequence is much larger than the code diff.

---
id: ch2
title: Chapter 2 — Configuration As Identity
fileRecommendations:
  readingOrder:
    - path: config/NEXTBSD
      description: Kernel configuration and identity
      type: source
    - path: README.md
      description: Build trigger and artifact overview
      type: docs
    - path: ci
      description: Continuous-integration support directory
      type: source
---

Kernel identity is partly source code and partly configuration. The `NEXTBSD` config includes the upstream kernel shape but gives the build its own identity and policy surface.

The CI files matter because this repository builds against a prepared FreeBSD source base. That turns kernel maintenance into a repeatable overlay operation: update the base, apply the patch series, build the configured kernel, then publish artifacts for downstream image assembly.

Read `config/NEXTBSD` as an argument, not merely as a list of options. It begins with `include GENERIC` and `ident NEXTBSD`, which means the default posture is inherited until a line explicitly changes it. Comments explain why some features are compiled in: NextBSD does not rely on a stock `/boot/kernel` module tree for some paths, so module-only FreeBSD features may need to become built-in kernel features.

Use the `ci` directory and `.github/workflows/build.yml` through the lens of reproducibility. The workflow applies `patches/series`, copies `config/NEXTBSD`, wires selected overlays, builds with `NO_MODULES=yes`, and uploads kernel objects for later module work. That is the operational version of the repository's architecture.

---
id: ch3
title: Chapter 3 — Kernel Policy Patches
fileRecommendations:
  readingOrder:
    - path: patches/0008-NextBSD-enable-unprivileged-mounts-vfs-usermount-1.patch
      description: NextBSD policy patch for unprivileged mounts
      type: source
    - path: patches/0009-NextBSD-default-elf64-fallback_brand-to-ELFOSABI_LINU.patch
      description: NextBSD policy patch for ELF64 Linux fallback branding
      type: source
    - path: patches/series
      description: Ordering context for policy patches
      type: source
---

Some NextBSD kernel changes are not new subsystems; they are policy decisions made persistent in the kernel because the rest of the operating system is intentionally not stock FreeBSD.

The unprivileged mount and ELF branding patches show this. Both are small in code size but large in operating-system behavior. They encode defaults that would otherwise live in FreeBSD rc scripts, sysctl configuration, or local administrator setup.

Patch `patches/0008-NextBSD-enable-unprivileged-mounts-vfs-usermount-1.patch` is a compact policy lesson. It changes the vfs.usermount default and makes the sysctl tunable at boot. The commit message also explains the security boundary: unprivileged mounts remain constrained, but the default favors desktop workflows such as mounting application images.

Patch `patches/0009-NextBSD-default-elf64-fallback_brand-to-ELFOSABI_LINU.patch` teaches compatibility policy. The change makes unbranded 64-bit ELF binaries fall back to Linux branding, which helps static Linux application runtimes. The same message also names the risk: an unbranded non-Linux ELF64 that used to fail cleanly may now be interpreted as Linux. That tradeoff is what kernel-policy patches should make visible.

After reading both patches, compare them to GhostBSD-style sysctl defaults. GhostBSD can use runtime sysctl configuration; NextBSD often moves the default into kernel source because its launch and boot model does not consume the same rc/sysctl path.

---
id: ch4
title: Chapter 4 — Overlays And Integration
fileRecommendations:
  readingOrder:
    - path: src-overlay
      description: Source overlay directory applied on top of the base
      type: source
    - path: patches/series
      description: Patch ordering before overlays and build
      type: source
    - path: README.md
      description: Relationship between kernel build, object artifact, and module builds
      type: docs
---

The overlay directory is the other half of the patch story. Patches change existing base files; overlays can add or replace source paths as part of the kernel build input.

For exploration, keep three layers separate in your head: the upstream FreeBSD source base, the ordered patch series, and the overlay/config/build workflow. NextBSD kernel behavior is the result of all three, not any single file.

The overlay layer is where this repository becomes more than a patch queue. `src-overlay` carries source and configuration fragments that are copied into the build tree by CI. Patches are best for modifying existing upstream files; overlays are better for adding new files or build fragments that should remain under NextBSD ownership.

Use `README.md` as the summary, then verify it against the workflow: patch application, identity rebranding, syscall table regeneration, config copy, overlay wiring, and artifact upload should all line up. If those steps ever diverge from the guide text, trust the workflow first and update the guide second.

The final reading exercise is to choose one feature from `config/NEXTBSD`, find the comment explaining why the feature is built in, then locate the overlay fragment or patch that makes it build. That exercise captures the whole NextBSD kernel model: base FreeBSD plus explicit deltas plus repeatable assembly.
