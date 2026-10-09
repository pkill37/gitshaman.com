---
curatedRepoId: ghostbsd-src
owner: ghostbsd
repo: ghostbsd-src
revision: b3f9cf4fa7f35fa8b084353e0dff0aa4799fc542
guideId: ghostbsd-kernel-guide
name: GhostBSD Kernel In The Mind
description: Understanding GhostBSD as a FreeBSD-derived desktop source tree
defaultOpenIds:
  - ch1
  - ch2
  - ch3
  - ch4
---

# GhostBSD Kernel In The Mind

GhostBSD is a FreeBSD-derived operating system with desktop-oriented defaults. Its kernel reading path starts in the same places as FreeBSD, but the interesting question is how a downstream system carries source changes, device defaults, and integration choices.

Read this guide as a downstream-maintenance exercise. The goal is not to prove that every subsystem was rewritten; the goal is to learn where a desktop BSD distribution changes the user-visible system while still relying on the FreeBSD kernel architecture.

---
id: ch1
title: Chapter 1 — A Downstream BSD Tree
fileRecommendations:
  readingOrder:
    - path: README.md
      description: Top-level FreeBSD-derived source tree roadmap
      type: docs
    - path: sys/README.md
      description: Kernel source directory guide
      type: docs
    - path: sys/conf/files
      description: Kernel build file manifest
      type: source
    - path: sys/conf/options
      description: Kernel option definitions
      type: source
    - path: sys/amd64/conf/GENERIC
      description: Representative amd64 kernel configuration
      type: source
---

GhostBSD keeps the recognizable FreeBSD source layout. That means `sys/` remains the center for kernel work, while `stand/`, `sbin/`, `etc/`, and the rest of userland provide the base-system context around it.

For kernel exploration, start by treating it as a FreeBSD tree and then look for downstream policy. Configuration defaults, device enablement, and desktop-facing integration points often tell you more about GhostBSD than low-level rewrites do.

The first reading pass should establish the inherited baseline. `sys/conf/files`, `sys/conf/options`, and `sys/amd64/conf/GENERIC` explain how the kernel is selected and compiled. Once you understand that baseline, downstream changes become easier to classify: source changes alter mechanisms, config changes alter what is compiled, and runtime defaults alter how stock mechanisms behave after boot.

Use `README.md` and `sys/README.md` only as orientation. The deeper habit is comparison: when a path looks familiar from FreeBSD, ask whether GhostBSD changed the implementation, the option set, or only the runtime posture.

---
id: ch2
title: Chapter 2 — Boot And Init
fileRecommendations:
  readingOrder:
    - path: stand/man/loader.8
      description: Loader manual covering the pre-kernel boot environment
      type: docs
    - path: sys/kern/init_main.c
      description: Kernel initialization sequence
      type: source
    - path: sys/sys/kernel.h
      description: SYSINIT declarations and ordering
      type: docs
    - path: sbin/sysctl/sysctl.conf
      description: Base sysctl defaults carried by the GhostBSD source tree
      type: source
---

The boot path is still FreeBSD-shaped: loader first, architecture entry next, then ordered kernel initialization. `SYSINIT` keeps initialization distributed while preserving dependency order.

GhostBSD-specific behavior often appears as configuration rather than a new kernel architecture. `sbin/sysctl/sysctl.conf` is a compact example: it records system defaults that affect runtime kernel behavior without changing subsystem code.

Read `sbin/sysctl/sysctl.conf` line by line as a policy document. The vfs.usermount setting changes who can mount filesystems; kern.ipc.shm_allow_removed supports desktop application behavior; kern.sched.preempt_thresh biases scheduler preemption for interactive use; USB audio and HID settings tune hardware behavior. None of those lines creates a new subsystem, but each changes what a desktop user experiences.

Then connect those defaults back to kernel code. The useful question is always "which kernel path observes this sysctl?" That turns configuration from a list of magic values into an index into VFS, scheduler, IPC, USB audio, and HID implementation.

---
id: ch3
title: Chapter 3 — Kernel Services
fileRecommendations:
  readingOrder:
    - path: sys/sys/proc.h
      description: Process and thread structures
      type: docs
    - path: sys/kern/kern_fork.c
      description: Process creation path
      type: source
    - path: sys/kern/sched_ule.c
      description: ULE scheduler implementation
      type: source
    - path: sys/vm/vm_fault.c
      description: Page fault handling
      type: source
    - path: sys/kern/vfs_subr.c
      description: VFS shared vnode machinery
      type: source
---

The core kernel services are inherited from the same BSD design: processes and threads, virtual memory, scheduling, and VFS. Read these files as the stable substrate GhostBSD relies on rather than as a separate desktop layer.

The important downstream reading habit is comparison. When a desktop distribution changes defaults, enables hardware support, or packages a different experience, the kernel core may remain close to upstream while the operating system behavior changes for desktop users.

Use the FreeBSD-shaped core as stable vocabulary. In `sys/sys/proc.h`, identify `struct proc` and `struct thread`; in `sys/kern/kern_fork.c`, follow process creation; in `sys/kern/sched_ule.c`, look for the policy that makes kern.sched.preempt_thresh meaningful. The GhostBSD-specific lesson is that a desktop default can sit layers away from the code that enforces it.

For VM and VFS, keep one example in mind: mounting or opening a desktop application image. VFS policy decides who may mount, VM handles mapped executable pages, and process code supplies credentials. GhostBSD does not need a new kernel architecture for that workflow; it needs inherited subsystems with different defaults.

---
id: ch4
title: Chapter 4 — Devices And Desktop Hardware
fileRecommendations:
  readingOrder:
    - path: sys/kern/subr_bus.c
      description: Device model core
      type: source
    - path: sys/sys/bus.h
      description: Driver and bus method interfaces
      type: docs
    - path: sys/dev/pci/pci.c
      description: PCI bus enumeration
      type: source
    - path: sys/dev/usb/usb_hid.c
      description: USB HID support
      type: source
    - path: sbin/sysctl/sysctl.conf
      description: Runtime setting enabling the newer USB HID path
      type: source
---

Desktop operating systems live or die on hardware behavior. GhostBSD's kernel tree exposes the same newbus and driver structure as FreeBSD, but downstream defaults can decide which support paths are active for users.

The USB HID setting in `sbin/sysctl/sysctl.conf` is a good example of distribution-level kernel policy. It does not replace the driver stack; it chooses a runtime posture for modern input devices.

Trace hardware support in two passes. First, read `sys/kern/subr_bus.c`, `sys/sys/bus.h`, and `sys/dev/pci/pci.c` to understand probe, attach, and bus-specific resource discovery. Then read `sys/dev/usb/usb_hid.c` next to the hw.usb.usbhid.enable default. That pairing shows the difference between a driver mechanism and a distribution decision to prefer that mechanism.

The practical takeaway is that downstream kernel work often lives at the boundary between code and defaults. For GhostBSD, the most educational files are the ones that reveal that boundary rather than the largest kernel files.
