---
curatedRepoId: reactos
owner: reactos
repo: reactos
revision: 0.4.16
guideId: reactos-guide
name: ReactOS In The Mind
description: Understanding ReactOS before reading the NT-compatible source tree
defaultOpenIds:
  - ch1
  - ch2
  - ch3
  - ch4
  - ch5
---

# ReactOS In The Mind

> This is not a guide to reproducing Windows. This guide reads ReactOS as a layered compatibility tree with its own build, kernel, and user-mode boundaries.

ReactOS is easiest to understand as an operating system that is trying to be structurally familiar to the Windows NT family while remaining an independent implementation. That means the important questions are architectural: where the kernel starts, where Win32 begins, and how the build composes the tree.

The tree is also large enough that reading it by file is the wrong start. Read it by subsystem and by build surface first.

---
id: ch1
title: Chapter 1 — The Tree and the Build Are the First Abstractions
fileRecommendations:
  readingOrder:
    - path: README.md#reactos
      description: Project overview, compatibility goals, and build instructions
      type: source
    - path: INSTALL
      description: Installation and build prerequisites
      type: source
    - path: CMakeLists.txt#L1
      description: Top-level build definition
      type: source
    - path: configure.sh#L1
      description: Unix-like configure entry point
      type: source
    - path: configure.cmd#L1
      description: Windows configure entry point
      type: source
---

ReactOS uses the build system as part of the architecture. `README.md` explains the project goals and how the tree is meant to be built. `INSTALL` adds the practical setup constraints. `CMakeLists.txt` and the `configure` entry points show that the repository is composed around generated build files rather than a single hand-written makefile.

That matters because compatibility work includes code, module selection, platform configuration, and build-time composition. If you understand how the tree is configured, you already understand a large part of how ReactOS behaves.

---
id: ch2
title: Chapter 2 — Kernel, HAL, and Boot Flow
fileRecommendations:
  readingOrder:
    - path: ntoskrnl/
      description: NT kernel core, system services, memory, object manager, and executive code
      type: directory
    - path: hal/
      description: Hardware abstraction layer and platform-specific low-level code
      type: directory
    - path: boot/
      description: Boot loader and early startup support
      type: directory
---

ReactOS keeps the core operating system split into explicit layers. This split separates portability from policy and keeps compatibility work localized. When debugging boot or kernel behavior, start by determining which layer owns the failure.

---
id: ch3
title: Chapter 3 — User Mode, Win32, and Shared DLLs
fileRecommendations:
  readingOrder:
    - path: dll/
      description: Shared system DLLs, Win32 APIs, and compatibility surfaces
      type: directory
    - path: base/
      description: Base system code and shared runtime pieces
      type: directory
    - path: modules/
      description: Application and subsystem modules that compose the OS image
      type: directory
---

ReactOS implements a large part of Windows compatibility above the kernel. This layer is where compatibility becomes visible to applications. Kernel correctness matters, but user-mode behavior is where most Windows-facing expectations are actually tested.

---
id: ch4
title: Chapter 4 — Drivers and Hardware Support
fileRecommendations:
  readingOrder:
    - path: drivers/
      description: Device drivers and hardware-facing subsystems
      type: directory
    - path: media/
      description: Installation media, sparse docs, and supporting material
      type: directory
    - path: sdk/
      description: SDK headers, build support, and developer-facing interfaces
      type: directory
---

ReactOS has to speak to real hardware, as well as emulate Windows APIs. For a tree this size, the hardware boundary and the developer boundary are both part of the architecture. You cannot understand the system if you only look at the kernel.

---
id: ch5
title: Chapter 5 — How to Read ReactOS Effectively
fileRecommendations:
  readingOrder:
    - path: README.md#reactos
      description: Re-anchor on project scope and compatibility claims
      type: source
    - path: ntoskrnl/
      description: Follow the kernel layer after the tree shape is clear
      type: directory
    - path: dll/
      description: Study Win32 behavior after the kernel boundary
      type: directory
    - path: drivers/
      description: Hardware support and portability decisions
      type: directory
    - path: sdk/
      description: Developer tooling and shared interfaces
      type: directory
---

That order works because ReactOS is a compatibility tree, spanning more than one subsystem. The architecture is spread across build, kernel, user mode, and hardware layers, and the directory layout makes those layers visible before you open an implementation file.
