---
curatedRepoId: sel4-15.0.0
owner: seL4
repo: seL4
revision: 15.0.0
guideId: sel4-guide
name: seL4 Microkernel In The Mind
description: Tracing capabilities, IPC, boot, scheduling, and verification boundaries in seL4 15.0.0
defaultOpenIds:
  - ch1
  - ch2
  - ch3
  - ch4
  - ch5
  - ch6
---

# seL4 Microkernel In The Mind

seL4 makes authority explicit: a thread acts through capabilities to kernel objects. Read this pinned 15.0.0 tree by following how the kernel resolves that authority, checks an operation, changes object state, and chooses the next runnable thread.

This repository contains the microkernel and its C bindings. A working system also needs a loader, an initial user task, services, and a compatible build environment. Filesystems, process policy, drivers, and application protocols do not appear automatically when the kernel boots.

---
id: ch1
title: Chapter 1 — What the Kernel Provides
fileRecommendations:
  readingOrder:
    - path: README.md
      description: Repository scope and links to complete system projects
      type: source
    - path: CMakeLists.txt
      description: Architecture selection, generated inputs, and kernel build targets
      type: source
    - path: configs/seL4Config.cmake
      description: Build-time kernel options
      type: source
    - path: include/config.h
      description: Checked-in wrapper around generated configuration
      type: source
    - path: libsel4/include/sel4/types.h
      description: Public C binding types
      type: source
    - path: include/api/types.h
      description: Kernel-side types and aliases
      type: source
---

Start by separating three layers: kernel mechanisms, user-level policy, and build configuration. The kernel supplies threads, capability operations, address-space mechanisms, IPC, and scheduling. User services decide which clients receive memory, device access, and service endpoints. A small kernel still needs a designed system around it.

The checked-in [configuration wrapper](include/config.h) includes generated configuration; the wrapper is checked in, while its included configuration is generated. Likewise, [kernel types](include/api/types.h) and [public binding types](libsel4/include/sel4/types.h) serve different consumers. Confusing these layers makes ABI changes harder to trace.

Before reading conditional code, record the architecture, platform, MCS setting, and core count. An enabled feature in this source tree does not mean that every binary contains it or that every proof covers it. Keep one configuration in mind throughout each execution trace.

---
id: ch2
title: Chapter 2 — Boot Creates the Initial Authority
fileRecommendations:
  readingOrder:
    - path: src/arch/arm/64/head.S
      description: AArch64 entry before init_kernel
      type: source
    - path: src/arch/arm/kernel/boot.c
      description: ARM boot orchestration and initial-thread setup
      type: source
    - path: src/kernel/boot.c
      description: Shared rootserver allocation and boot helpers
      type: source
    - path: manual/parts/bootup.tex
      description: Initial task, BootInfo, and initial capabilities
      type: docs
    - path: libsel4/src/sel4_bootinfo.c
      description: User-side BootInfo access
      type: source
---

The direction matters: architecture entry code runs first, architecture-specific C boot code prepares the machine and initial objects, and shared helpers supply common boot operations. On AArch64, follow [assembly entry](src/arch/arm/64/head.S) into [init_kernel](src/arch/arm/kernel/boot.c:init_kernel), then inspect its initialization path and calls into [shared boot code](src/kernel/boot.c).

Boot creates the initial thread and its CSpace and VSpace, prepares its image, and describes available resources through BootInfo. Untyped capabilities let the initial task turn available memory into later objects. This task begins with broad authority; distributing smaller capabilities to children is a user-level responsibility.

Use [the pinned boot manual](manual/parts/bootup.tex) to interpret BootInfo ranges. Distinguish ordinary untyped memory from device memory. A physical-memory description is not a ready-made allocator, and a capability slot number is not a mapped address.

An instructive reading exercise is to locate initial-thread creation, initial scheduling-state setup, and untyped creation in the ARM boot path. Then compare the RISC-V port. Shared helpers do not imply identical machine entry sequences.

---
id: ch3
title: Chapter 3 — CSpace Lookup and Delegation
fileRecommendations:
  readingOrder:
    - path: src/kernel/cspace.c:resolveAddressBits
      description: Guard, radix, and depth checks during CSpace lookup
      type: source
    - path: src/object/cnode.c
      description: Capability copying, minting, deletion, and revocation
      type: source
    - path: include/object/structures.h
      description: Capability and object representation
      type: source
    - path: manual/parts/cspace.tex
      description: CSpace addressing and capability operations
      type: docs
---

A CPtr names a capability through a thread's CSpace. Its meaning depends on the calling thread’s CSpace. CNodes contain capability slots; lookup consumes address bits through CNode guards and radix fields. Start with [resolveAddressBits](src/kernel/cspace.c:resolveAddressBits) and follow its failed-lookup cases before its successful return.

A capability combines a reference with authority. Two capabilities can refer to the same endpoint while granting different rights or carrying different badges. A badge labels an invocation for the receiver; it does not establish a global user identity. A server must define how its issued badges map to clients.

Copying a capability does not copy its object. Minting can restrict rights and set permitted capability data. [CNode operations](src/object/cnode.c) maintain derivation metadata so that revocation can remove descendants. Deleting one slot and revoking descendants answer different questions; neither should be described as deleting every reference everywhere without inspecting the derivation relationship.

For a concrete exercise, trace a failed guard check, then a successful endpoint lookup. Ask which root capability was used, how much depth was consumed, and which rights the later invocation checks. Authority resolution and operation validation are distinct steps.

---
id: ch4
title: Chapter 4 — The ABI Has Two Generation Paths
fileRecommendations:
  readingOrder:
    - path: manual/README.md
      description: System calls versus object invocations
      type: docs
    - path: libsel4/include/api/syscall.xml
      description: System-call IDs and configuration-dependent syscall sets
      type: source
    - path: libsel4/include/interfaces/object-api.xml
      description: Architecture-independent object methods
      type: source
    - path: libsel4/tools/syscall_stub_gen.py
      description: Object-invocation marshalling generator
      type: source
    - path: libsel4/CMakeLists.txt
      description: Inputs and outputs of binding generation
      type: source
    - path: libsel4/include/sel4/syscalls.h
      description: Checked-in selection of MCS or classic syscall wrappers
      type: source
    - path: src/api/syscall.c:handleInvocation
      description: Kernel-side invocation decoding
      type: source
---

Separate top-level system calls from object methods. Send, Recv, and Call enter the message-passing interface. Operations such as TCB_Resume and CNode_Copy encode a method label and arguments in an invocation of a kernel object, commonly through Call. The [manual's API-generation explanation](manual/README.md) states this distinction directly.

[The syscall schema](libsel4/include/api/syscall.xml) supplies syscall-number generation. [Object-interface XML](libsel4/include/interfaces/object-api.xml), together with architecture-specific interface XML, feeds the [stub generator](libsel4/tools/syscall_stub_gen.py). These are related but different inputs. The checked-in [syscalls header](libsel4/include/sel4/syscalls.h) selects MCS or non-MCS wrappers; calling it a generated header hides that selection.

Trace one object method from XML to the generator's marshalling rules, then to [handleInvocation](src/api/syscall.c:handleInvocation) and object dispatch. Generated C bindings help keep representations aligned; they do not make an arbitrary request valid. The kernel still checks capability type, rights, message length, extra capabilities, and object-specific arguments.

Use bindings built for the same configuration as the kernel. MCS changes the syscall interface and reply model, so swapping headers between variants can change semantics as well as compilation results.

---
id: ch5
title: Chapter 5 — Scheduling and MCS
fileRecommendations:
  readingOrder:
    - path: src/kernel/thread.c:schedule
      description: Runnable-thread selection and scheduling transitions
      type: source
    - path: src/kernel/sporadic.c
      description: MCS budget replenishment machinery
      type: source
    - path: src/object/schedcontext.c
      description: Scheduling-context operations
      type: source
    - path: src/object/reply.c
      description: MCS reply-object machinery
      type: source
    - path: manual/parts/threads.tex
      description: Priority, scheduling contexts, budgets, and donation
      type: docs
    - path: include/model/statedata.h
      description: Scheduler and per-core state
      type: source
---

A TCB describes a thread, but runnable state alone does not explain when it can execute. Read [schedule](src/kernel/thread.c:schedule) alongside priorities, domain scheduling, and the selected MCS configuration. Do not describe all variants as one scheduler with optional extra accounting.

With MCS enabled, a thread needs access to a scheduling context to run. A context carries a budget and period; the [thread manual](manual/parts/threads.tex) explains their units and constraints. A budget smaller than the period uses sporadic replenishments, while equal budget and period supports round-robin behavior. Follow replenishment state in [sporadic.c](src/kernel/sporadic.c) rather than assuming an exhausted budget resets on the next dispatch.

Passive servers can receive donated scheduling contexts through IPC. Reply objects track the call relationship and return donated execution capacity. Blocking, replying, and nested calls affect both communication and execution resources. A server's own context versus a donated context changes who pays for its work.

Budgets provide mechanisms for controlling CPU consumption. A complete temporal-isolation argument still depends on configuration, interrupt handling, resource sharing, and system policy. Kernel support alone does not establish a latency guarantee for an application. Try tracing one client call through donation, server execution, and reply before reasoning about a chain of servers.

---
id: ch6
title: Chapter 6 — Configurations and Verification Boundaries
fileRecommendations:
  readingOrder:
    - path: configs/AARCH64_verified.cmake
      description: AArch64 preset and concrete platform selection
      type: source
    - path: configs/include/AARCH64_verified_include.cmake
      description: Verification-oriented feature and optimization settings
      type: source
    - path: configs/ARM_MCS_verified.cmake
      description: A separate MCS configuration preset
      type: source
    - path: configs/RISCV64_verified.cmake
      description: RISC-V configuration entry
      type: source
    - path: configs/X64_verified.cmake
      description: x86-64 configuration entry
      type: source
---

Treat a configuration as part of the artifact being assessed. The AArch64 preset selects a platform and includes settings for architecture, core count, optimization, printing, and other features. Changing one setting can change the code and the evidence needed to justify it.

The word “verified” in a preset filename is not a proof certificate for every build from that file. Match the kernel revision, architecture, configuration, property, and corresponding proof revision. The proofs live in the separate l4v project. Consult the [official configuration guidance](https://docs.sel4.systems/projects/sel4/verified-configurations.html) for how these pieces fit; its current coverage descriptions must not be applied to this pinned 15.0.0 tree.

Functional correctness, security properties, and binary-level results are distinct claims. Each has a scope and assumptions. The [verification overview](https://sel4.systems/Verification/) describes dependencies on hardware and machine interfaces and boundaries involving boot, assembly, and DMA. A proved kernel property does not automatically verify a driver, filesystem server, application protocol, or whole deployed system.

A useful review question is: which exact claim remains justified after this configuration or source change? Reading this guide does not run those proofs. Build success and runtime tests supply different evidence and should be reported separately.

---
id: ch7
title: Chapter 7 — Untyped Memory and Object Lifetime
fileRecommendations:
  readingOrder:
    - path: src/object/untyped.c:decodeUntypedInvocation
      description: Retype argument and destination checks
      type: source
    - path: src/object/untyped.c:invokeUntyped_Retype
      description: Memory reset and object-creation invocation
      type: source
    - path: src/object/objecttype.c:createNewObjects
      description: Creation of objects and derived capabilities
      type: source
    - path: src/object/objecttype.c:createObject
      description: Type-specific initial object state
      type: source
    - path: src/object/cnode.c:cteRevoke
      description: Revocation of derived capabilities
      type: source
    - path: manual/parts/objects.tex
      description: Object types and allocation rules
      type: docs
---

Object creation requires explicit authority over memory. A manager with an untyped capability can retype its memory into supported objects, subject to type, size, alignment, destination-slot, and device-memory rules. User-level allocators decide how to subdivide and distribute that resource.

Read [decodeUntypedInvocation](src/object/untyped.c:decodeUntypedInvocation) before [invokeUntyped_Retype](src/object/untyped.c:invokeUntyped_Retype). The decoder rejects invalid requests; the invocation performs state changes, including resetting reusable memory when required. [createNewObjects](src/object/objecttype.c:createNewObjects) initializes objects and installs their capabilities with derivation relationships.

Object lifetime follows capability relationships and object-specific finalization rules. [Revocation](src/object/cnode.c:cteRevoke) removes descendants; deletion can trigger cleanup when the relevant final capability disappears. Neither operation retracts information already copied into another protection domain. Resource reclamation and confidentiality of shared data are separate concerns.

Exercise: follow an untyped capability into a new endpoint, copy an endpoint capability to another slot, and identify which revocation removes the derived authority. Then repeat conceptually for a frame with mappings. The latter requires understanding both capability lifetime and address-space state.

---
id: ch8
title: Chapter 8 — A Synchronous IPC Round Trip
fileRecommendations:
  readingOrder:
    - path: src/api/syscall.c:handleInvocation
      description: Lookup and invocation entry after trap dispatch
      type: source
    - path: src/object/objecttype.c:decodeInvocation
      description: Dispatch based on capability type
      type: source
    - path: src/object/endpoint.c:sendIPC
      description: Sender blocking or rendezvous with a receiver
      type: source
    - path: src/object/endpoint.c:receiveIPC
      description: Receiver queueing or rendezvous with a sender
      type: source
    - path: src/kernel/thread.c:doIPCTransfer
      description: Message and capability transfer
      type: source
    - path: src/fastpath/fastpath.c
      description: Specialized eligible Call and ReplyRecv paths
      type: source
    - path: manual/parts/ipc.tex
      description: Message layout, rights, and reply semantics
      type: docs
---

Consider a client calling a server endpoint. In the general path, [handleInvocation](src/api/syscall.c:handleInvocation) resolves the client's CPtr and obtains message information. [decodeInvocation](src/object/objecttype.c:decodeInvocation) dispatches an endpoint capability to the IPC machinery after its relevant checks.

An endpoint is a synchronous rendezvous object. If a compatible receiver is waiting, [sendIPC](src/object/endpoint.c:sendIPC) can pair the threads and transfer the message. Otherwise a blocking sender waits on the endpoint. The queue contains waiting threads; detached messages do not remain in a mailbox. [receiveIPC](src/object/endpoint.c:receiveIPC) handles the opposite arrival order.

Follow [doIPCTransfer](src/kernel/thread.c:doIPCTransfer) into normal-message transfer to see message registers, IPC buffers, badges, and capability transfer handled separately. Capability transfer requires suitable rights and a valid receiving arrangement. Shared-memory payloads need a separate mapping and synchronization protocol; sending a pointer does not map its referent into the recipient.

Call establishes a reply relationship and waits for a response. Classic and MCS builds represent that relationship differently, so read the matching manual sections. Eligible operations can take [fast paths](src/fastpath/fastpath.c); the general trace explains semantics without claiming every call executes every decoder. Inspect the fast-path eligibility checks before making performance claims.

---
id: ch9
title: Chapter 9 — Notifications, Faults, and Address Spaces
fileRecommendations:
  readingOrder:
    - path: src/object/notification.c
      description: Signalling, waiting, and notification state
      type: source
    - path: src/kernel/faulthandler.c:handleFault
      description: Fault delivery to a configured handler
      type: source
    - path: manual/parts/notifications.tex
      description: Notification badge accumulation and bound threads
      type: docs
    - path: manual/parts/vspace.tex
      description: Architecture-dependent virtual-memory objects and mapping
      type: docs
    - path: manual/parts/threads.tex
      description: Fault endpoints and thread configuration
      type: docs
    - path: src/arch/arm/64/kernel/vspace.c
      description: ARM address-space operations and VM-fault handling
      type: source
---

Notifications are useful for asynchronous events, but they are not endpoint messages with a different wait mode. Pending badge bits accumulate with bitwise OR. Repeated signals with the same bit can coalesce, so a notification alone cannot count every event. Use shared state or another protocol when counts or payloads matter. Follow [notification state transitions](src/object/notification.c) alongside the [notification manual](manual/parts/notifications.tex).

A CSpace controls object authority; a VSpace controls address translation. Holding a frame capability does not itself map that frame, and a virtual address is meaningful only in the relevant address space. Page-table construction and mapping operations require the right architecture-specific capabilities and valid parameters.

A VM fault can be delivered as IPC to a configured user-level fault handler. That handler needs both a policy for the fault and authority to repair the mapping, then arrange resumption through the relevant fault-reply protocol. The kernel does not automatically provide Linux-style demand paging, file-backed mappings, or an out-of-memory policy.

Trace [fault delivery](src/kernel/faulthandler.c:handleFault), then inspect [ARM VSpace handling](src/arch/arm/64/kernel/vspace.c) and the [mapping manual](manual/parts/vspace.tex). Distinguish detecting a translation failure from deciding which resource should resolve it. Fault handlers are part of the system's availability and security design.

---
id: ch10
title: Chapter 10 — Build a System and Compare the Boundaries
fileRecommendations:
  readingOrder:
    - path: README.md
      description: Starting points for tutorials, build dependencies, and seL4Test
      type: source
    - path: manual/README.md
      description: Building the pinned reference manual
      type: docs
    - path: libsel4/CMakeLists.txt
      description: Bindings that must match the kernel configuration
      type: source
    - path: repo:torvalds/linux/kernel/fork.c
      description: Linux task creation for comparison with explicit seL4 object setup
      type: source
    - path: repo:torvalds/linux/mm/mmap.c
      description: Linux mapping policy compared with user-managed seL4 VSpaces
      type: source
    - path: repo:torvalds/linux/drivers/android/binder.c
      description: Binder transactions compared with endpoint IPC
      type: source
---

For a first runnable experiment, use the complete tutorial or seL4Test project linked from [this release's README](README.md). Follow that project's dependency and toolchain instructions, select a supported target, and keep its manifest and kernel revision together. This source browser's kernel checkout alone does not supply a runnable application image.

Record the manifest revisions, target, compiler, configuration, and whether MCS is enabled. Build and run the project's smallest example before adding a server. Then add one endpoint exchange, one invalid capability lookup, and one handled mapping fault. These experiments test your understanding of mechanisms; they do not discharge formal proof obligations.

The [Linux guide](repo:torvalds/linux/kernel/fork.c) provides a useful contrast: Linux builds process behavior around task creation and integrated memory-management policy. seL4 exposes smaller objects from which user-level managers construct their own process abstraction. A CPtr and a Linux file descriptor both name authority-bearing resources, but their lookup, inheritance, and revocation rules differ.

For Android readers, compare [Binder transactions](repo:torvalds/linux/drivers/android/binder.c) with the endpoint round trip. Binder adds a driver-managed protocol and object-reference machinery inside Linux; seL4 endpoints provide kernel IPC primitives on which user services define protocols. This is a comparison of boundaries, not a claim that either API can replace the other unchanged. The Linux links use the site's independently pinned Linux baseline.
