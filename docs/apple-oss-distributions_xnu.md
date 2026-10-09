---
curatedRepoId: apple-xnu
owner: apple-oss-distributions
repo: xnu
revision: xnu-12377.1.9
guideId: xnu-kernel-guide
name: XNU Kernel In The Mind
description: Understanding Apple's Hybrid Kernel Before Code
defaultOpenIds:
  - ch1
  - ch2
  - ch3
  - ch4
  - ch5
  - ch6
  - ch7
  - ch8
  - ch9
---

# XNU Kernel In The Mind

> XNU is not a monolithic kernel, not a microkernel, but a deliberate hybrid — and that decision shapes everything.

Each chapter is a self-contained reflection on kernel behavior — how XNU enforces contracts between its layers, isolates drivers from the core, and exposes POSIX to a world built on Mach abstractions.

**Three layers run together. Let's understand why.**

---
id: ch1
title: Chapter 1 — A Kernel of Three Minds
fileRecommendations:
  readingOrder:
    - path: osfmk/mach/mach_types.h
      description: Mach type definitions visible to user space
      type: docs
    - path: osfmk/kern/startup.c
      description: Kernel startup — Mach subsystem initialization sequence
      type: source
    - path: bsd/kern/bsd_init.c
      description: BSD layer initialization — POSIX personality brought online
      type: source
    - path: iokit/Kernel/IOStartIOKit.cpp
      description: I/O Kit startup — C++ runtime and driver matching begins
      type: source
    - path: osfmk/kern/task.c:task_create
      description: Mach task — the fundamental unit of resource ownership
      type: source
  directories:
    - path: osfmk/
      description: Mach kernel core: tasks, threads, IPC, VM, scheduler, and architecture glue.
      type: directory
    - path: bsd/
      description: POSIX and Unix layer: processes, syscalls, networking, VFS, credentials, and signals.
      type: directory
    - path: iokit/
      description: Driver framework: C++ service objects, matching, driver lifecycle, and device abstractions.
      type: directory
    - path: libkern/
      description: Shared kernel runtime support used by I/O Kit and lower-level kernel code.
      type: directory
    - path: pexpert/
      description: Platform expert layer that adapts XNU startup and hardware discovery to each Apple platform.
      type: directory
---

XNU stands for "X is Not Unix." The name is accurate in the ways that matter: the kernel's core is Mach, not Unix. BSD is layered on top. Drivers live in a separate C++ framework called I/O Kit. All three run in the same address space, at the same privilege level — this is why Apple calls it a hybrid kernel.

The three layers have distinct identities. **Mach** owns the primitives: tasks, threads, ports, virtual memory, and inter-process communication. Mach derives from Carnegie Mellon's Mach 3 microkernel research and forms the substrate everything else runs on. **BSD** provides the POSIX personality: processes, file descriptors, signals, sockets, and the system call interface most applications use. It sits on top of Mach but has bidirectional dependencies — BSD processes are represented by both a Mach task and a BSD `proc`. **I/O Kit** is the driver framework. It uses a strict C++ class hierarchy and a publish-subscribe matching system so drivers load and unload without touching core kernel code.

The decision to colocate all three in one address space was pragmatic. Pure microkernels like Mach 3 suffered serious performance penalties from IPC-on-every-operation. By merging BSD and Mach into a single kernel image, Apple preserved the conceptual separation while eliminating the message-passing overhead for cross-layer calls.

This layering shows up everywhere in the source: `osfmk/` holds Mach, `bsd/` holds the BSD subsystem, `iokit/` holds the driver framework, `libkern/` holds the C++ runtime both I/O Kit and BSD use, and `pexpert/` abstracts the specific hardware platform.

---
id: ch2
title: Chapter 2 — Mach Primitives
fileRecommendations:
  readingOrder:
    - path: osfmk/kern/task.h
      description: Mach task API
      type: docs
    - path: osfmk/kern/thread.h
      description: Mach thread activation API
      type: docs
    - path: osfmk/mach/port.h
      description: Port right types and semantics
      type: docs
    - path: osfmk/mach/message.h
      description: Mach message header layout
      type: docs
    - path: osfmk/kern/task.c:task_create
      description: task_create(), task_terminate() — Mach task lifecycle
      type: source
    - path: osfmk/kern/thread.c:thread_create
      description: thread_create(), thread_terminate() — Mach thread lifecycle
      type: source
    - path: osfmk/ipc/ipc_port.c
      description: Port allocation, rights management, and port destruction
      type: source
    - path: osfmk/ipc/mach_msg.c:mach_msg_overwrite_trap
      description: mach_msg() — the fundamental IPC primitive
      type: source
    - path: osfmk/kern/ipc_tt.c
      description: Task/thread IPC state — how tasks own their port namespaces
      type: source
---

In Mach, the two fundamental abstractions are tasks and threads. A **task** is a container for resources: an address space, a set of port rights, and a collection of threads. It resembles a Unix process, but it has no executable context on its own — threads do the executing. A **thread** is the schedulable unit; it carries register state and a kernel stack, and always lives inside one task.

**Ports** are the IPC primitive. A port is a kernel-managed message queue. You interact with a port through a **port right** — a capability that lives in a task's port namespace. The key rights are: SEND (send messages to the port), RECEIVE (dequeue messages from the port), and SEND_ONCE (send one message, then the right is consumed). Rights are per-task: two tasks can hold SEND rights to the same port without knowing each other's identity. The kernel enforces all transfers and revocations.

`mach_msg()` is the single system call that covers all IPC. A message is a header followed by a body of typed descriptors. Descriptors can carry port rights (transferring capability between tasks), out-of-line memory (the kernel copies or remaps the physical pages — zero-copy for large transfers), and inline data. The kernel validates the entire message before any delivery occurs.

This design makes Mach IPC a security boundary. A service that only holds a SEND right to a port cannot steal messages or impersonate the receiver. The kernel's name-translation step — resolving a port name (a 32-bit integer local to the task) to the kernel port object — is where access control happens. Every capability requires an explicit grant; authority is never ambient.

---
id: ch3
title: Chapter 3 — Virtual Memory as a Mach Contract
fileRecommendations:
  readingOrder:
    - path: osfmk/mach/vm_prot.h
      description: VM protection flags
      type: docs
    - path: osfmk/mach/vm_statistics.h
      description: VM statistics counters
      type: docs
    - path: osfmk/vm/vm_shared_region.h
      description: Shared memory region (dyld shared cache)
      type: docs
    - path: osfmk/vm/vm_map.c:vm_map_enter
      description: vm_map_enter(), vm_map_remove() — virtual address range management
      type: source
    - path: osfmk/vm/vm_fault.c:vm_fault
      description: vm_fault() — page fault resolution and pager dispatch
      type: source
    - path: osfmk/vm/memory_object.c
      description: Memory object protocol — the pager interface
      type: source
    - path: osfmk/vm/vm_object.c
      description: vm_object — the unit of backing store
      type: source
    - path: osfmk/vm/vm_pageout.c
      description: Pageout daemon — memory pressure and eviction
      type: source
---

XNU's virtual memory system is pure Mach. Every task has a `vm_map_t` — a sorted list of `vm_map_entry` objects, each describing a range of virtual addresses with associated protections and a backing `vm_object`. The `vm_object` is the unit of backing store: it holds a list of resident pages and a pointer to a **memory object** (pager) that can supply or reclaim pages on demand.

The **pager** protocol is the key design. A `vm_map_entry` doesn't know whether its backing store is a file, anonymous memory, or a device. It calls into the pager — a Mach port — and the pager resolves pages. The default pager handles anonymous memory (swap). The vnode pager connects VM to the VFS layer. The device pager handles memory-mapped hardware. This indirection makes the VM layer independent of where bytes come from.

A page fault in XNU flows: hardware raises a fault → `machine_fault_handler()` in arch-specific code → `vm_fault()` in `osfmk/vm/vm_fault.c` → looks up the `vm_map_entry` → calls into the pager's `memory_object_data_request` → pager fills the page → `vm_fault()` installs the PTE → returns to user space. If no entry covers the faulting address, the task receives a `SIGSEGV` via BSD signal delivery.

Copy-on-write is implemented at the `vm_object` level. When a task forks, child and parent share the same `vm_object` entries, all mapped read-only. A write fault allocates a new page, copies the content, and updates only the faulting task's PTE — the parent's mapping is unaffected. The `vm_object` shadow chain tracks the number of COW divergence levels for a given address range.

---
id: ch4
title: Chapter 4 — BSD Over Mach
fileRecommendations:
  readingOrder:
    - path: bsd/sys/proc.h
      description: struct proc — BSD process descriptor
      type: docs
    - path: bsd/sys/proc_internal.h
      description: Internal proc fields
      type: docs
    - path: bsd/sys/filedesc.h
      description: File descriptor table
      type: docs
    - path: bsd/kern/kern_proc.c
      description: BSD proc structure — POSIX process state anchored to a Mach task
      type: source
    - path: bsd/kern/kern_fork.c:fork1
      description: fork() — creates a new BSD proc and duplicates the Mach task
      type: source
    - path: bsd/kern/kern_exec.c:execve
      description: execve() — loads a new image into an existing task
      type: source
    - path: bsd/kern/sys_generic.c
      description: read(), write(), select() — generic BSD syscall implementations
      type: source
    - path: bsd/kern/kern_exit.c
      description: exit() — process teardown across both BSD and Mach layers
      type: source
---

Every Unix process in XNU has a dual identity. The Mach layer represents it as a **task** — an address space and a set of threads. The BSD layer represents it as a **proc** — a POSIX process with a PID, a parent, file descriptors, signal state, and credentials. The two are linked: `proc->task` points to the Mach task; the Mach task carries a back-pointer to the BSD proc. Neither layer owns the other; they are peers that were designed to interoperate.

`fork()` in `bsd/kern/kern_fork.c` creates both halves simultaneously. It calls `task_create_internal()` to duplicate the Mach task (copying the address space via COW vm_map duplication), then allocates and initializes a new BSD `proc` structure, copies the file descriptor table, signal handlers, and credentials, and then wires child to parent via the `p_pptr` / `p_children` lists. The child thread begins executing at the point `fork()` returns zero — in the same copied virtual address space.

`execve()` is more destructive: it loads a new binary into the *existing* task. `bsd/kern/kern_exec.c` calls `task_halt()` to pause all other threads, then replaces the `vm_map` with a fresh one containing mappings from the new binary's segments, resets the BSD `proc`'s signals and credentials as appropriate, and resumes execution at the new entry point. The Mach task identity (and thus the PID's Mach task port) is preserved across exec.

File descriptors live entirely in the BSD layer (`bsd/sys/filedesc.h`). The fd table maps integers to `fileproc` objects, each of which points to a `fileglob` that wraps a `vnode`, socket, pipe, or kqueue. The kernel object behind each fd is independent of BSD — sockets are `struct socket` objects from `bsd/net/`, vnodes are managed by VFS, pipes are `struct pipe` in `bsd/kern/sys_pipe.c`.

---
id: ch5
title: Chapter 5 — VFS and the Vnode
fileRecommendations:
  readingOrder:
    - path: bsd/sys/vnode.h
      description: struct vnode and vnode operations table
      type: docs
    - path: bsd/sys/vnode_internal.h
      description: Internal vnode fields
      type: docs
    - path: bsd/sys/mount.h
      description: mount structure — per-filesystem state
      type: docs
    - path: bsd/vfs/vfs_vnops.c:vn_read
      description: vn_read(), vn_write() — vnode read/write dispatch
      type: source
    - path: bsd/vfs/vfs_syscalls.c
      description: open(), read(), stat() — VFS syscall entry points
      type: source
    - path: bsd/vfs/vfs_lookup.c:namei
      description: namei() — path resolution to a vnode
      type: source
    - path: bsd/vfs/vfs_cache.c
      description: Name cache (dnlc) — directory entry lookup cache
      type: source
    - path: bsd/vfs/kpi_vfs.c
      description: KPI — the filesystem plugin interface
      type: source
---

XNU's Virtual File System layer follows the same VFS abstraction pioneered in SunOS: a uniform `vnode` interface over heterogeneous filesystems. Every file, directory, device node, and named pipe is represented by a `vnode`. A vnode is a kernel object with an operations table (`vnode_op_desc`) — a vtable of function pointers the concrete filesystem fills in for `read`, `write`, `lookup`, `create`, `rename`, `fsync`, and so on.

Path resolution (`bsd/vfs/vfs_lookup.c`) converts a string like `/usr/lib/dyld` into a vnode. It walks the path component by component: start at the mount's root vnode, call `VNOP_LOOKUP` on each directory vnode with the next name component, following mount points and symlinks as needed. The name cache (`bsd/vfs/vfs_cache.c`) short-circuits repeated lookups: successful `(parent_vnode, name)` → `child_vnode` mappings are cached in a hash table. A stat on a cached path involves no disk I/O.

APFS, HFS+, and third-party filesystems provide the operations defined by the filesystem plugin interface (`bsd/vfs/kpi_vfs.c`). A filesystem registers with `vfs_fsadd()`, providing a `vfsops` (mount, unmount, sync, statfs) and a per-vnode `vnodeops` table. From that point the VFS layer routes all operations through the registered function pointers without knowing anything about the on-disk format.

Unified Buffer Cache integrates VM and VFS: file data is cached in `vm_object` pages associated with the vnode's underlying pager. `read()` on a cached file hits the page cache and returns without disk I/O; `mmap()` of the same file shares those exact pages. Cache consistency is maintained because both paths go through the same `vm_object`.

---
id: ch6
title: Chapter 6 — I/O Kit and the Driver Model
fileRecommendations:
  readingOrder:
    - path: iokit/IOKit/IOService.h
      description: IOService public interface
      type: docs
    - path: iokit/IOKit/IORegistryEntry.h
      description: IORegistryEntry interface
      type: docs
    - path: iokit/IOKit/IOMemoryDescriptor.h
      description: IOMemoryDescriptor interface
      type: docs
    - path: libkern/libkern/c++/OSObject.h
      description: OSObject — root of the I/O Kit class hierarchy
      type: docs
    - path: iokit/Kernel/IOService.cpp:IOService::start
      description: IOService — base class for every I/O Kit driver
      type: source
    - path: iokit/Kernel/IORegistryEntry.cpp
      description: IORegistryEntry — the node in the hardware device graph
      type: source
    - path: iokit/Kernel/IOMemoryDescriptor.cpp#L1120
      description: IOMemoryDescriptor — DMA-safe memory abstraction
      type: source
    - path: iokit/Kernel/IOInterruptEventSource.cpp
      description: Interrupt event source — wires hardware IRQs into the workloop
      type: source
    - path: iokit/Kernel/IOWorkLoop.cpp#L900
      description: IOWorkLoop — single-threaded serialization for a driver stack
      type: source
---

I/O Kit is the driver framework, written in a restricted subset of C++ and running entirely in kernel space. The restriction matters — no exceptions, no RTTI (replaced by a custom dynamic cast system in `libkern`), and no dynamic memory allocation in interrupt context. Drivers are loadable kernel extensions (kexts) that link against the I/O Kit C++ framework at runtime.

The **IOService** class is the root of every driver. Its lifecycle is: probe (does this driver match this device?), start (initialize hardware and publish services), and stop (tear down). A driver subclasses `IOService`, overrides `probe()`, `start()`, and `stop()`, and registers itself with a matching dictionary — a property list that describes which hardware it handles (vendor ID, device class, etc.). The I/O Kit registry matches loaded drivers against detected hardware using these dictionaries; no driver code runs until a matching device appears.

The **IORegistry** is a live graph of the system's hardware topology. Every device is an `IORegistryEntry` node with a parent-child relationship reflecting the physical bus hierarchy (PCI bus → PCI device → function → driver). User space can walk this graph via the `IOKitLib` API to discover devices, query properties, and call driver methods without knowing kernel internals.

**IOMemoryDescriptor** abstracts DMA-safe memory. A driver never manipulates physical addresses directly; it creates an `IOMemoryDescriptor` over a virtual buffer, calls `prepare()` to wire and map the pages for DMA, and passes the descriptor to the hardware. The descriptor handles IOMMU mapping, cache coherency operations, and the distinction between physical and virtual addresses. `complete()` reverses the mapping and allows pages to be reclaimed.

The **IOWorkLoop** is a single dedicated thread that serializes all driver activity. Interrupt event sources (`IOInterruptEventSource`) and timer event sources schedule callbacks into the workloop. This model eliminates a class of driver concurrency bugs: a well-written I/O Kit driver never needs explicit locks because all its logic runs serialized through the workloop.

---
id: ch7
title: Chapter 7 — Entering XNU
fileRecommendations:
  readingOrder:
    - path: osfmk/mach/syscall_sw.h
      description: Mach trap numbers
      type: docs
    - path: bsd/sys/sysent.h
      description: BSD syscall entry table — number-to-handler mapping
      type: docs
    - path: osfmk/arm64/sleh.c
      description: Synchronous/async exception handler — all arm64 kernel entries
      type: source
    - path: bsd/kern/syscalls.master
      description: BSD syscall table — number-to-function mapping
      type: source
    - path: osfmk/kern/syscall_sw.c
      description: Mach trap table — Mach trap number-to-function mapping
      type: source
    - path: osfmk/kern/ipc_mig.c
      description: MIG-generated IPC dispatch — translates port messages to C calls
      type: source
    - path: bsd/kern/kdebug.c
      description: Kernel debug tracing — the ktrace/kdebug infrastructure
      type: source
---

XNU has two separate system call tables. BSD syscalls use small positive numbers (0–550) and enter through the platform's exception vector into `unix_syscall64()` in `bsd/dev/arm64/`. Mach traps use small negative numbers and dispatch through `mach_call_munger64()` into the trap table in `osfmk/kern/syscall_sw.c`. From user space the calling convention is identical — a `svc #0x80` instruction on arm64 — but the sign of the syscall number determines which table is consulted.

On arm64 all kernel entries (syscalls, hardware exceptions, IRQs) flow through the exception vectors defined in `osfmk/arm64/`. A synchronous exception (including `svc`) saves all general-purpose registers onto the kernel stack and calls `sleh_synchronous()` in `osfmk/arm64/sleh.c`. This function decodes the ESR_EL1 (Exception Syndrome Register) to determine the cause and dispatches accordingly: `svc` goes to the syscall handler, data abort goes to the VM fault handler, undefined instruction goes to signal delivery.

Mach traps are fast. `task_self_trap()` (trap -28) returns the calling task's task port name in a single kernel call. `mach_msg_trap()` (trap -31) is the IPC gateway: it validates the message, looks up port rights in the calling task's namespace, copies or maps the message body, and either enqueues the message on the target port or blocks the calling thread. All Mach IPC ultimately flows through this trap.

MIG (Mach Interface Generator) generates the glue code that converts an incoming Mach message into a C function call. The kernel's own subsystems (vm, task, thread, host) are exposed via MIG-generated dispatch tables in `osfmk/kern/ipc_mig.c`. When a user-space client calls `vm_allocate()` via the Mach user-side stub, the stub constructs a message, sends it to the kernel's VM port, and the kernel-side MIG demuxer calls `vm_allocate_trap()` or routes it to the full IPC path.

---
id: ch8
title: Chapter 8 — Security Architecture
fileRecommendations:
  readingOrder:
    - path: osfmk/mach/task_policy.h
      description: Task policy flavor definitions
      type: docs
    - path: bsd/sys/codesign.h
      description: Code signing flags and structures
      type: docs
    - path: bsd/kern/kern_credential.c
      description: Credential management — UID, GID, entitlements
      type: source
    - path: security/mac_base.c
      description: MAC framework dispatch — the hook layer for security policies
      type: source
    - path: osfmk/kern/cs_blobs.h
      description: Code signing blobs — validation and attachment to tasks
      type: source
    - path: bsd/kern/kern_codesigning.c
      description: Page-level code signing enforcement
      type: source
    - path: osfmk/kern/task_policy.c
      description: Task security policy — sandboxing state per task
      type: source
---

XNU enforces security at distinct layers designed to operate independently — a failure in one does not automatically compromise another.

**Code signing** is enforced at the page level. When the VM fault handler maps an executable page into a task, `cs_validate_page()` in `osfmk/vm/vm_fault.c` computes a SHA-256 hash of the page and compares it against the code signing blob attached to the binary's Mach-O load commands. A mismatch kills the task at the fault. This happens for every new code page, including JIT-compiled pages (which require a special `CS_EXECSEG_JIT` entitlement to bypass). The enforcement point is the fault handler itself — there is no way to map unsigned executable code without the kernel's explicit cooperation.

The **MAC (Mandatory Access Control) framework** (`security/mac_base.c`) is an in-kernel hook system derived from TrustedBSD. Security policies — including the Sandbox, TCC (Transparency Consent and Control), and the kernel's own security policy — register hook implementations for over 1,000 MAC entry points covering file operations, network operations, process lifecycle events, IPC, and more. When a sandboxed process calls `open()`, the VFS layer calls `mac_vnode_check_open()`, which iterates all registered policies; any policy can deny the operation. The Sandbox policy evaluates the calling process's sandbox profile against the requested operation.

**Entitlements** are a capability system layered on top of code signing. An entitlement is a key-value pair embedded in the code signing blob. The kernel reads entitlements when attaching a signing blob to a task and stores them in the task's `cs_blob`. At runtime, `IOService::copyClientEntitlement()` checks whether a calling task's blob carries a specific entitlement key before granting privileged I/O Kit operations. User-space entitlement checks go through `SecTaskCopyValueForEntitlement()`, which reads the same blob via the kernel's signing infrastructure.

**Mach port-based isolation** is the third pillar. A sandboxed process has a restricted port namespace: it cannot look up arbitrary services in `launchd`'s bootstrap namespace, because the Sandbox policy denies `bootstrap_lookup()` for services not listed in the sandbox profile. Since Mach IPC is the foundation of all inter-process communication, restricting port rights is a comprehensive way to limit what a sandboxed process can reach.

---
id: ch9
title: Chapter 9 — Reading XNU
fileRecommendations:
  readingOrder:
    - path: osfmk/kern/
      description: Mach kernel core — scheduler, IPC, VM
      type: directory
    - path: bsd/kern/
      description: BSD subsystem core — process, file, socket management
      type: directory
    - path: iokit/Kernel/
      description: I/O Kit framework implementation
      type: directory
    - path: osfmk/kern/startup.c
      description: Kernel entry — read top-to-bottom for the init sequence
      type: source
    - path: bsd/kern/kern_fork.c:fork1
      description: fork() — best cross-layer example (Mach task + BSD proc)
      type: source
    - path: osfmk/ipc/mach_msg.c:mach_msg_overwrite_trap
      description: mach_msg() — the IPC core
      type: source
    - path: osfmk/vm/vm_fault.c:vm_fault
      description: vm_fault() — VM fault resolution and code signing enforcement
      type: source
    - path: iokit/Kernel/IOService.cpp:IOService::start
      description: IOService::probe/start/stop — driver lifecycle in full
      type: source
---

The three minds of XNU each have coherent internal structure; the cross-layer calls are the interesting part.

XNU differs from Linux in one fundamental respect: **IPC is a first-class kernel abstraction, not an optimization.** Where Linux uses direct function calls between kernel subsystems, XNU subsystems communicate through Mach ports. This is slower in the uncontended case but provides a hard isolation boundary: a subsystem that exposes only a port interface cannot be called in ways its author didn't expect. The security architecture depends on this — port rights are capabilities, and capabilities are the correct foundation for least-privilege design.

The hybrid design means reading a single code path often means crossing two source trees. An `open()` syscall enters through `bsd/vfs/vfs_syscalls.c`, resolves the path through `bsd/vfs/vfs_lookup.c`, checks the MAC policy via `security/mac_base.c`, allocates a file descriptor in `bsd/kern/kern_descrip.c`, and may trigger a VM pager interaction in `osfmk/vm/` when the first read maps file pages. Following that call end-to-end is the fastest way to understand how the layers communicate.
