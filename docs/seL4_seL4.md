---
curatedRepoId: sel4-15.0.0
owner: seL4
repo: seL4
revision: 15.0.0
guideId: sel4-guide
name: seL4 Microkernel In The Mind
description: Understanding seL4 as a capability-based microkernel, ABI generator, and verified kernel tree
defaultOpenIds:
  - ch1
  - ch2
  - ch3
  - ch4
  - ch5
  - ch6
---

# seL4 Microkernel In The Mind

> seL4 is easiest to understand when you read it as a tree of contracts: boot code, capability management, generated ABI, architecture ports, and build-time configuration all reinforce the same kernel model.

This guide follows the downloaded seL4 15.0.0 tree. It starts from the top-level build and manual files, then moves into the kernel boot path, the capability/object model, syscall generation, scheduling and faults, and then the architecture/configuration layer that makes the same kernel run across ARM, RISC-V, and x86.

**The important question is not "what does this function do?" but "which contract does this layer enforce?"**

---
id: ch1
title: Chapter 1 — What seL4 Is Optimized For
fileRecommendations:
  readingOrder:
    - path: README.md
      description: Project overview, release context, and where seL4 fits in the larger build ecosystem
      type: source
    - path: CMakeLists.txt
      description: Top-level build graph that decides which architecture, configuration, and libraries are compiled
      type: source
    - path: configs/seL4Config.cmake
      description: Kernel configuration entry point for build-time options and feature selection
      type: source
    - path: manual/README.md#the-sel4-reference-manual
      description: Reference manual entry point and documentation structure
      type: docs
    - path: include/config.h
      description: Generated kernel configuration header consumed by C and assembly code
      type: source
    - path: include/api/types.h
      description: Public kernel ABI types that anchor the user-facing contract
      type: source
---

seL4 is not a general-purpose monolithic kernel. The microkernel keeps policy out of the kernel wherever possible and makes authority explicit through capabilities.

The README and top-level build files matter because seL4 often forms part of a larger system rather than a standalone binary. `CMakeLists.txt` and `configs/seL4Config.cmake` decide which arch, platform, and verification settings are in play; `include/config.h` turns those selections into compile-time truth. In seL4, build configuration is not decoration. The configuration forms part of the kernel contract.

The generated ABI types in `include/api/types.h` show the shape of that contract from the outside. They are the user-visible vocabulary for objects, rights, faults, and system call results.

---
id: ch2
title: Chapter 2 — Boot and Architecture Bring-Up
fileRecommendations:
  readingOrder:
    - path: src/kernel/boot.c:init_core_state
      description: Kernel bootstrap logic that connects architecture bring-up to the initial kernel state
      type: source
    - path: include/kernel/boot.h
      description: Shared boot-time declarations used by the kernel and architecture layers
      type: source
    - path: src/arch/arm/64/head.S
      description: ARM64 early entry and machine-state setup before C code runs
      type: source
    - path: src/arch/riscv/head.S
      description: RISC-V early entry path and trap/stack setup
      type: source
    - path: src/arch/x86/64/head.S
      description: x86-64 early entry and CPU mode transition path
      type: source
    - path: src/arch/arm/kernel/boot.c
      description: ARM-specific boot logic after the generic kernel entrypoint
      type: source
    - path: src/arch/riscv/kernel/boot.c
      description: RISC-V kernel boot path and machine-mode handoff
      type: source
    - path: src/arch/x86/kernel/boot.c
      description: x86-specific kernel boot sequence and low-level setup
      type: source
---

Boot is where seL4 proves it can be small and still portable. The generic kernel boot path establishes the initial state, then the architecture layer takes over to set up trap entry, registers, and the machine features that the kernel depends on.

The architecture tree is split by ISA and width: ARM 32/64, RISC-V, and x86 32/64. That split is not arbitrary. The split defines the boundary between kernel invariants and hardware-specific entry mechanics.

If you want to understand how seL4 can stay the same kernel while running across CPU architectures, start here. The boot path shows which assumptions are universal and which ones are delegated to the port.

---
id: ch3
title: Chapter 3 — Capabilities and Kernel Objects
fileRecommendations:
  readingOrder:
    - path: src/kernel/cspace.c
      description: Capability lookup and derivation logic
      type: source
    - path: src/object/objecttype.c:createObject
      description: Object dispatch and type-level behavior for kernel objects
      type: source
    - path: src/object/cnode.c
      description: Capability node implementation and CSpace structure
      type: source
    - path: src/object/tcb.c#L114
      description: Thread control block implementation and thread state transitions
      type: source
    - path: src/object/endpoint.c#L47
      description: IPC endpoint object used for message passing
      type: source
    - path: src/object/notification.c
      description: Notification object used for asynchronous signalling
      type: source
    - path: src/object/untyped.c
      description: Untyped memory retyping and object creation path
      type: source
    - path: include/object/objecttype.h
      description: Object type definitions used throughout the kernel
      type: source
    - path: include/object/structures.h
      description: Shared object layouts and structural definitions
      type: source
---

Capabilities are the center of seL4's security model. The kernel does not ask "who are you?" in a global identity sense. It asks "what authority does this capability grant, and where can it be copied or derived?"

The model becomes concrete when capability lookup, object creation, and object dispatch meet. Read those pieces as one authority path rather than as independent subsystems.

The important idea is that object creation is not free-form. Untyped memory is retyped into concrete kernel objects, which means authority and memory allocation are tied together from the start.

---
id: ch4
title: Chapter 4 — Generated ABI and User-Level Bindings
fileRecommendations:
  readingOrder:
    - path: include/api/syscall.h
      description: Kernel-facing syscall declarations and interface entry points
      type: source
    - path: libsel4/include/api/syscall.xml
      description: Source of truth for generated syscall definitions
      type: source
    - path: libsel4/tools/syscall_stub_gen.py
      description: Generator that produces language bindings and syscall stubs
      type: source
    - path: libsel4/include/sel4/syscalls.h
      description: Generated user-level syscall interface
      type: source
    - path: libsel4/include/sel4/functions.h
      description: User-facing API helpers layered on top of the generated syscalls
      type: source
    - path: libsel4/src/sel4_bootinfo.c
      description: Bootinfo helpers that expose kernel state to user space
      type: source
---

seL4's ABI is intentionally generated rather than hand-maintained in a single header. That is how the project keeps the kernel implementation, the C bindings, and the manual consistent.

The syscall schema is the source of truth. This generated layer is where the kernel stops being abstract and becomes something user code can call.

If the capability model is seL4's security story, the generated ABI is its usability story. It gives userland a stable, typed interface without making the kernel hand-write the same contract in separate places.

---
id: ch5
title: Chapter 5 — Scheduling, Faults, and MCS
fileRecommendations:
  readingOrder:
    - path: src/kernel/thread.c:schedule
      description: Thread lifecycle, scheduling, and runnable state management
      type: source
    - path: src/kernel/faulthandler.c:handleFault
      description: Fault delivery and kernel-side fault handling
      type: source
    - path: src/kernel/sporadic.c
      description: Sporadic scheduling support for MCS-style execution control
      type: source
    - path: src/model/preemption.c
      description: Preemption model used by the kernel scheduler and interrupts
      type: source
    - path: src/model/smp.c
      description: Shared SMP state and inter-core coordination model
      type: source
    - path: src/smp/lock.c
      description: SMP locking primitives used by the kernel core
      type: source
    - path: include/kernel/thread.h
      description: Thread data structures and scheduler-facing declarations
      type: source
    - path: include/model/statedata.h
      description: Global kernel state shared across scheduler and architecture code
      type: source
---

Scheduling in seL4 is smaller than in a monolithic kernel, but remains central to the system. Threads, faults, preemption, and multiprocessor state all have to agree on who is runnable and who owns execution right now.

`src/kernel/thread.c` and `src/kernel/faulthandler.c` cover the basic kernel execution model. `src/kernel/sporadic.c` matters because seL4 15.0.0 carries MCS-related scheduling support, which pushes the scheduler toward time-partitioned execution rather than a simple always-runnable model.

The model files under `src/model/` and the SMP lock code show where the kernel keeps global state and how it prevents races as execution scales beyond one CPU.

---
id: ch6
title: Chapter 6 — Ports and Configurations
fileRecommendations:
  readingOrder:
    - path: configs/AARCH64_verified.cmake
      description: ARM64 configuration entry point
      type: source
    - path: configs/RISCV64_verified.cmake
      description: RISC-V 64-bit configuration entry point
      type: source
    - path: configs/X64_verified.cmake
      description: x86-64 verified configuration entry point
      type: source
    - path: configs/ARM_MCS_verified.cmake
      description: ARM MCS configuration showing how scheduling policy is selected at build time
      type: source
    - path: configs/RISCV64_MCS_verified.cmake
      description: RISC-V MCS configuration entry point
      type: source
    - path: include/arch/arm/arch/machine.h
      description: ARM architecture-specific machine declarations
      type: source
    - path: include/arch/riscv/arch/machine.h
      description: RISC-V architecture-specific machine declarations
      type: source
    - path: include/arch/x86/arch/machine.h
      description: x86 architecture-specific machine declarations
      type: source
---

The configuration layer is where seL4 becomes a concrete product. A single kernel tree can target different architectures and scheduling variants, but only the selected configuration is compiled into the image.

The verified config files under `configs/` are the most direct way to see the supported combinations. They sit above the architecture tree and below the build system: they decide which code is even eligible to compile.

This is also where the tree reminds you that seL4 extends beyond kernel source: the configurable, generated, and architecture-parameterized system keeps the verified contract intact while shifting platform details into the right layer.
