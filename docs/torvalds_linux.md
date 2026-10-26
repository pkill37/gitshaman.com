---
curatedRepoId: linux-v6.1
owner: torvalds
repo: linux
revision: v6.1
guideId: linux-kernel-guide
name: Linux Kernel In The Mind
description: Understanding Linux Kernel Before Code
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
  - ch10
---

# Linux Kernel In The Mind

> This isn't a guide to writing kernel code. It's an effort to understand how the Linux kernel thinks.

Each chapter is a self-contained reflection on kernel behavior — not on function calls, but on **behavior, not syntax**. Taken together they build a conceptual map of how the kernel responds, enforces, isolates, and serves.

**The kernel runs everything. Let's understand how it runs.**

---
id: ch1
title: Chapter 1 — The Kernel Is Not a Process
fileRecommendations:
  readingOrder:
    - path: Documentation/scheduler/sched-design-CFS.rst#CFS+Scheduler
      description: Scheduler design and kernel thread management
      type: docs
    - path: Documentation/core-api/kernel-api.rst#Kernel+Threads
      description: Kernel thread API
      type: docs
    - path: Documentation/kernel-hacking/hacking.rst#Rules+and+guidelines
      description: Rules for writing correct kernel code
      type: docs
    - path: init/main.c:start_kernel
      description: start_kernel() — the first C function after boot
      type: source
    - path: include/linux/sched.h:task_struct
      description: task_struct — every process/thread as the kernel sees it (about 850 fields)
      type: source
    - path: init/init_task.c
      description: Open init/init_task.c to study the boot idle task with PID 0
      type: source
    - path: repo:freebsd/freebsd-src/sys/sys/proc.h:proc
      description: FreeBSD struct proc — BSD process identity separated from threads
      type: source
    - path: repo:freebsd/freebsd-src/sys/kern/kern_fork.c:fork1
      description: FreeBSD fork1() — BSD process creation path
      type: source
    - path: repo:apple-oss-distributions/xnu/osfmk/kern/task.c:kernel_task
      description: Open XNU osfmk/kern/task.c to study kernel address-space ownership
      type: source
    - path: repo:apple-oss-distributions/xnu/bsd/kern/kern_fork.c:fork1
      description: XNU fork1() — BSD proc creation bridged to Mach task creation
      type: source
    - path: arch/arm64/include/asm/current.h#L10
      description: current macro — how arm64 finds the running task_struct
      type: source
    - path: kernel/fork.c:kernel_clone
      description: kernel_clone() — how fork() and clone() create tasks
      type: source
    - path: kernel/kthread.c:kthreadd
      description: Kernel threads — how they differ from user processes
      type: source
    - path: fs/readdir.c:SYSCALL_DEFINE3
      description: getdents() syscall path — userspace directory reads through the VFS
      type: source
---

In Linux, the kernel image is not a single process. It has no one PID, no user-space address space, and no single scheduler slot. The kernel provides those resources and identities to tasks. Linux still represents execution with `task_struct`: the statically allocated boot idle task is defined in [`init/init_task.c`](init/init_task.c). This is the original swapper/0 task with PID 0. Later background work runs in kernel threads, but [`kthreadd`](kernel/kthread.c:kthreadd) itself is PID 2 on normal Linux systems, not PID 0.

The contrast with BSD and Mach is useful because they draw the boundaries differently. FreeBSD keeps process identity in [struct proc](repo:freebsd/freebsd-src/sys/sys/proc.h:proc) and points each thread back to its owning process, while [fork1()](repo:freebsd/freebsd-src/sys/kern/kern_fork.c:fork1) builds that BSD process object. XNU carries both ideas: the kernel task defined in [XNU task.c](repo:apple-oss-distributions/xnu/osfmk/kern/task.c:kernel_task) is a Mach task object, and XNU's BSD [fork1()](repo:apple-oss-distributions/xnu/bsd/kern/kern_fork.c:fork1) creates a BSD `proc` while calling into Mach task creation. That is why macOS can expose the [kernel task from XNU task.c](repo:apple-oss-distributions/xnu/osfmk/kern/task.c:kernel_task) as PID 0, while Linux's PID 0 is the boot idle `task_struct`, not a process-shaped kernel image.

When a process reads a directory, a library such as `readdir(3)` often hides the lower-level [`getdents64(2)`](getdents64(2)) call. That syscall returns a buffer of variable-length directory records; the VFS path in [`fs/readdir.c:getdents`](fs/readdir.c:getdents) fills those records, and the library turns them into a convenient iterator. At the boundary, the CPU switches from ring 3 to ring 0. The same CPU core now executes kernel code *in the context of your process*, reads `task_struct` via the [`current` macro](arch/arm64/include/asm/current.h:current), and returns. The user-space side of this boundary is visible in glibc's [`read` wrapper](repo:bminor/glibc/sysdeps/unix/sysv/linux/read.c:__libc_read), which turns a C library call into the syscall ABI. The kernel never "runs alongside" your program; it runs *as* it, briefly, on request. Kernel threads exist for background work (memory reclamation, IRQ processing) but they're the exception, not the rule.

Every process's virtual address space includes a kernel mapping at high addresses. Those pages carry supervisor-only PTEs, so they're inaccessible from ring 3. The mapping exists so syscall entry doesn't require a full address-space switch — only a privilege-level change.

This distinction explains three consequences: why kernel code must be non-blocking (no separate process to schedule away), why kernel bugs crash the whole machine (no isolation from the rest of the kernel), and why synchronization in the kernel is so different from user-space threading.

---
id: ch2
title: Chapter 2 — Subsystem Map
fileRecommendations:
  readingOrder:
    - path: Documentation/scheduler/sched-design-CFS.rst#Scheduler+classes
      description: Scheduler documentation
      type: docs
    - path: Documentation/mm/page_tables.rst#Page+Tables
      description: Memory management internals
      type: docs
    - path: Documentation/filesystems/vfs.rst#The+Virtual+File+System
      description: VFS and filesystem documentation
      type: docs
    - path: Documentation/networking/netdevices.rst#Network+device+operations
      description: Networking stack documentation
      type: docs
    - path: Documentation/driver-api/driver-model/overview.rst#Overview
      description: Driver development API
      type: docs
    - path: arch/arm64/kernel/entry-common.c:el0t_64_sync_handler
      description: Syscall and interrupt entry for arm64
      type: source
    - path: mm/mmap.c:do_mmap
      description: Virtual memory area management — mmap() implementation
      type: source
    - path: mm/page_alloc.c:__alloc_pages
      description: Buddy allocator — physical page allocation
      type: source
    - path: fs/namei.c:path_lookupat
      description: Path lookup — how /a/b/c resolves to an inode
      type: source
    - path: net/socket.c:__sys_socket
      description: Socket syscall interface
      type: source
---

For an ordinary buffered regular-file read, subsystem handoffs can follow this route. Pipes, sockets, devices, direct I/O, cache hits, and filesystem choices can take different paths:

- A `read(2)` syscall enters through [`arch/arm64/kernel/entry-common.c:el0t_64_sync_handler`](arch/arm64/kernel/entry-common.c:el0t_64_sync_handler).
- It dispatches into [`fs/read_write.c:vfs_read`](fs/read_write.c:vfs_read).
- The VFS calls the filesystem's `->read_iter()` hook in the filesystem operation area of [`include/linux/fs.h:file_operations`](include/linux/fs.h:file_operations).
- The request hits the page cache in [`mm/filemap.c:generic_file_read_iter`](mm/filemap.c:generic_file_read_iter).
- On a cache miss, block I/O flows through [`block/blk-core.c:submit_bio_noacct`](block/blk-core.c:submit_bio_noacct) to a driver.

---
id: ch3
title: Chapter 3 — Memory as Responsibility
fileRecommendations:
  readingOrder:
    - path: Documentation/mm/page_tables.rst#Page+Tables
      description: Memory management overview and internals
      type: docs
    - path: Documentation/admin-guide/mm/numa_memory_policy.rst#NUMA+memory+policy
      description: Memory zones, NUMA, huge pages
      type: docs
    - path: Documentation/core-api/memory-allocation.rst#L1
      description: Which allocator to use and when
      type: docs
    - path: Documentation/arm64/memory.rst#Memory+Layout
      description: arm64 virtual address space and memory layout documentation
      type: docs
    - path: Documentation/virt/kvm/index.rst#KVM
      description: Virtual memory documentation
      type: docs
    - path: mm/mmap.c:do_mmap
      description: mmap() implementation — VMA creation and management
      type: source
    - path: mm/page_alloc.c:__alloc_pages
      description: Physical page allocator — buddy system
      type: source
    - path: include/linux/mm_types.h:mm_struct
      description: mm_struct, vm_area_struct, page — the core data structures
      type: source
---

The kernel doesn't view memory as a flat map — it tracks it as a responsibility. Every byte of physical RAM is represented by a `struct page`. Every range of a process's virtual address space is a `struct vm_area_struct` (VMA). The process as a whole carries a `struct mm_struct` linking them together.

Physical memory is organized into NUMA nodes → zones → page blocks → pages. The buddy allocator ([`mm/page_alloc.c:__alloc_pages`](mm/page_alloc.c:__alloc_pages)) satisfies page-granularity requests, splitting and coalescing power-of-two blocks to fight fragmentation. Smaller allocations go through SLUB ([`mm/slub.c:kmem_cache_alloc`](mm/slub.c:kmem_cache_alloc)), which maintains per-CPU caches of fixed-size objects.

Virtual memory is populated on demand. [`mmap(2)`](mmap(2)) creates a mapping and returns its virtual address; for an ordinary anonymous or file mapping, physical pages may be supplied later as accesses trigger page faults. The fault handler ([`arch/arm64/mm/fault.c:do_mem_abort`](arch/arm64/mm/fault.c:do_mem_abort)) checks permissions, obtains or reads a page, and installs a PTE. `MAP_PRIVATE` makes writes private through copy-on-write, while `MAP_SHARED` makes suitable writes visible through the shared mapping. Copy-on-write for [`fork(2)`](fork(2)) uses the same mechanism: child and parent initially refer to shared pages that are made read-only, and a write fault creates a private copy.

Isolation is enforced structurally. Each process has its own `mm_struct` and its own page tables. The kernel is mapped into every process's address space at high virtual addresses, but those pages carry supervisor-only PTEs — inaccessible from ring 3. The canonical arm64 layout is documented in [`Documentation/arm64/memory.rst#Memory+Layout`](Documentation/arm64/memory.rst#Memory+Layout).

### Android Binder is a driver-managed mapping example

To distinguish a mapping from an allocator request, start at [LineageOS ProcessState](repo:LineageOS/android/frameworks/native/libs/binder/ProcessState.cpp). It maps the Binder device's receive-buffer range. Follow [binder_mmap](drivers/android/binder.c:binder_mmap) into [binder_alloc_mmap_handler](drivers/android/binder_alloc.c:binder_alloc_mmap_handler) to inspect how this driver initializes its userspace range. It has different responsibilities from an anonymous heap mapping.

Return to [GrapheneOS's allocator integration](repo:GrapheneOS/platform_manifest/bionic/libc/bionic/malloc_common.cpp) or [ART's heap configuration](repo:LineageOS/android/art/runtime/gc/heap.cc) for allocation policy above the kernel. A mapping address, a Python or Java object, and an allocator-owned block are different units. The Android device's actual kernel can differ from this Linux 6.1 baseline.

---
id: ch4
title: Chapter 4 — From Power-On to Init
fileRecommendations:
  readingOrder:
    - path: Documentation/arm64/booting.rst#Booting+the+kernel
      description: arm64 boot and early bring-up documentation
      type: docs
    - path: Documentation/admin-guide/kernel-parameters.rst#L1
      description: Every boot parameter the kernel accepts
      type: docs
    - path: Documentation/admin-guide/binfmt-misc.rst#L1
      description: How the kernel recognizes and loads binary formats
      type: docs
    - path: Documentation/bpf/index.rst#eBPF
      description: eBPF subsystem — runtime extensibility
      type: docs
    - path: init/main.c:start_kernel
      description: start_kernel() — subsystem initialization sequence
      type: source
    - path: arch/arm64/kernel/head.S#L73
      description: Early arm64 boot — image entry and setup before start_kernel()
      type: source
    - path: init/init_task.c
      description: Open init/init_task.c to study the boot idle task with PID 0
      type: source
    - path: kernel/pid.c:init_struct_pid
      description: init_struct_pid — the kernel's internal PID 0 object
      type: source
---

The boot sequence splits into two worlds: architecture-specific and architecture-neutral.

The firmware (BIOS/UEFI) loads the bootloader, which decompresses the kernel image and jumps to [`arch/arm64/kernel/head.S#L73`](arch/arm64/kernel/head.S#L73). That entry code sets up the initial execution environment, establishes the processor state needed for kernel execution, and then jumps to [`start_kernel()`](init/main.c:start_kernel).

[`start_kernel()`](init/main.c:start_kernel) is the first function that looks like normal C. It initializes subsystems in strict dependency order: memory first (so other subsystems can request memory), then the scheduler, IRQs, the VFS, and network. Each `xxx_init()` call is a one-time setup; a panic here means the system cannot boot.

Before PID 1 exists, the boot CPU is already executing as the statically allocated boot idle task. Open [`init/init_task.c`](init/init_task.c) to study its definition. In [`kernel/pid.c:init_struct_pid`](kernel/pid.c:init_struct_pid), that task receives numeric PID 0; in [`init/init_task.c`](init/init_task.c), its command name is `swapper`. This is the original bootstrap/idle scheduler task, conventionally visible as swapper/0, not [`kthreadd`](kernel/kthread.c:kthreadd) and not the userspace init process.

The last act of [`start_kernel()`](init/main.c:start_kernel) is [`rest_init()`](init/main.c:rest_init). It first creates PID 1 running `kernel_init()` so that init obtains the reserved process ID, then creates PID 2 running [`kthreadd`](kernel/kthread.c:kthreadd), the daemon that creates and manages later kernel threads. PID 1 mounts the root filesystem, executes the init binary (`/sbin/init` or systemd), and becomes the first userspace process. The original boot task then calls `schedule_preempt_disabled()` and enters the CPU idle loop.

Running ./hello from a shell involves the shell calling [`execve(2)`](execve(2)), which reaches [`fs/exec.c:do_execveat_common`](fs/exec.c:do_execveat_common). On success, `execve()` does **not** return: it replaces the calling process's program image, maps the new ELF segments, constructs the initial stack with `argv`/`envp`, and sets up the initial user-space entry. For a dynamically linked ELF executable with PT_INTERP, [load_elf_binary](fs/binfmt_elf.c:load_elf_binary) also maps the ELF interpreter and enters its entry point. With glibc, [the dynamic loader](repo:bminor/glibc/elf/rtld.c:_dl_start) prepares shared dependencies and relocations before transferring to the application's startup entry (`_start` on the example ABI). Static executables and static PIE follow different startup paths. Process identity and attributes such as the PID survive the replacement, while memory mappings are discarded and file descriptors marked close-on-exec are closed. From `_start`, glibc's [`__libc_start_main`](repo:bminor/glibc/csu/libc-start.c:__libc_start_main) performs user-space startup before calling `main()`. For a Unix CPython executable, [Programs/python.c](repo:python/cpython/Programs/python.c:main) supplies main and calls [Py_BytesMain](repo:python/cpython/Modules/main.c:Py_BytesMain). Importing an extension later can invoke [dlopen](repo:python/cpython/Python/dynload_shlib.c:_PyImport_FindSharedFuncptr) inside that existing process; it does not repeat execve.

### Compare Linux PID 1 with Android init

[LineageOS init main](repo:LineageOS/android/system/core/init/main.cpp:main) and [GrapheneOS init main](repo:GrapheneOS/platform_manifest/system/core/init/main.cpp:main) are userspace Android startup code, separate from Linux's kernel initialization functions. Their [service configuration](repo:LineageOS/android/system/core/rootdir/init.rc) expresses Android actions and services; the Linux kernel does not parse that file.

Continue through [app_process](repo:LineageOS/android/frameworks/base/cmds/app_process/app_main.cpp:main) into [ZygoteInit](repo:LineageOS/android/frameworks/base/core/java/com/android/internal/os/ZygoteInit.java:forkSystemServer) and [SystemServer startup](repo:LineageOS/android/frameworks/base/services/java/com/android/server/SystemServer.java:startBootstrapServices). This links the generic kernel task and executable-loading concepts to the Android processes that ultimately start applications and SystemUI. Use the manifest-selected device kernel when reproducing a particular boot.

---
id: ch5
title: Chapter 5 — Entering the Kernel
fileRecommendations:
  readingOrder:
    - path: Documentation/core-api/kernel-api.rst#System+Calls
      description: System call interface
      type: docs
    - path: Documentation/core-api/genericirq.rst#Introduction
      description: Interrupt subsystem internals
      type: docs
    - path: Documentation/virt/kvm/index.rst#KVM
      description: KVM — guest syscall handling via VMEXIT
      type: docs
    - path: Documentation/virt/kvm/api.rst#L1
      description: KVM API reference
      type: docs
    - path: arch/arm64/kernel/entry-common.c:el0t_64_sync_handler
      description: Syscall entry — where user space crosses into the kernel
      type: source
    - path: fs/sync.c:ksys_sync
      description: Generic system call implementations
      type: source
    - path: include/uapi/asm-generic/unistd.h:__NR_read
      description: Syscall number table
      type: source
---

Three paths lead into the kernel: **syscalls** (intentional, from user space), **hardware interrupts** (asynchronous, from devices), and **exceptions** (synchronous CPU faults — page fault, divide-by-zero, breakpoints). All three converge on [`arch/arm64/kernel/entry-common.c:el0t_64_sync_handler`](arch/arm64/kernel/entry-common.c:el0t_64_sync_handler).

A syscall uses the `svc #0` exception instruction, which transitions from user mode into the kernel and jumps to the entry point. [`arch/arm64/kernel/entry.S:el0_svc`](arch/arm64/kernel/entry.S:el0_svc) saves registers onto the kernel stack, then the syscall dispatcher indexes `sys_call_table` by syscall number and calls the handler. On return, registers are restored and `eret` drops back to user space.

Hardware interrupts use a separate path. Each vector in the exception table points to a handler in [`arch/arm64/kernel/entry-common.c:el1h_64_irq_handler`](arch/arm64/kernel/entry-common.c:el1h_64_irq_handler). IRQ handlers run in **interrupt context** — no sleeping, no blocking locks, fast completion. Slow work is deferred to softirqs, tasklets, or workqueues.

In virtualization, a guest OS sees its own [`arch/arm64/kernel/entry-common.c:el0t_64_sync_handler`](arch/arm64/kernel/entry-common.c:el0t_64_sync_handler) and believes it runs on bare metal. But when the guest executes a privileged instruction, the CPU performs a VMEXIT, saving guest registers and handing control to KVM on the host. KVM inspects the exit reason, emulates or delegates, then resumes the guest with the arm64 return path — all without leaving host kernel mode.

---
id: ch6
title: Chapter 6 — Execution and Contexts
fileRecommendations:
  readingOrder:
    - path: Documentation/scheduler/sched-design-CFS.rst#CFS+Scheduler
      description: Scheduler documentation
      type: docs
    - path: Documentation/scheduler/sched-design-CFS.rst#CFS+Scheduler
      description: CFS design — virtual runtime, weights, and red-black tree
      type: docs
    - path: Documentation/locking/locktypes.rst#Lock+types
      description: All locking primitives — spinlocks, mutexes, RCU
      type: docs
    - path: Documentation/core-api/workqueue.rst#Workqueues
      description: Workqueues — deferred work from interrupt context
      type: docs
    - path: kernel/fork.c:kernel_clone
      description: kernel_clone() — complete process/thread creation path
      type: source
    - path: kernel/exit.c:do_exit
      description: do_exit() — process termination and resource cleanup
      type: source
    - path: fs/exec.c:do_execveat_common
      description: execve() — loading and starting a new program image
      type: source
    - path: kernel/sched/core.c:schedule
      description: schedule() and context_switch() — the core dispatcher
      type: source
    - path: kernel/sched/fair.c:enqueue_task_fair
      description: CFS — virtual runtime and the red-black tree
      type: source
---

The CPU is stateless — it executes whatever instruction `%rip` points to, regardless of ownership. The kernel supplies all the state: each task gets a `task_struct`, a kernel stack, and a set of page tables. The [`current` macro](arch/arm64/include/asm/current.h:current) is a per-CPU pointer to the running task's `task_struct`; all kernel code uses it to know whose context it's in.

`fork()` calls [`kernel_clone()`](kernel/fork.c:kernel_clone), which duplicates the parent's `task_struct`, copies or shares file descriptors, signal handlers, and the memory descriptor, and places the new task on a run queue. Threads share the `mm_struct` (same address space); processes get a copy-on-write duplicate.

The CFS scheduler tracks each task's **virtual runtime** — actual CPU time weighted by priority. It always picks the task with the lowest vruntime. Tasks live in a per-CPU red-black tree keyed by vruntime; [`schedule()`](kernel/sched/core.c:schedule) pops the leftmost node. A context switch saves the outgoing task's registers onto its kernel stack and restores the incoming task's — the entire CPU state changes through a sequence of save and restore instructions.

Interrupt context is categorically different: assume no sleeping [`current` task](arch/arm64/include/asm/current.h:current), never block, and bound the work done in the handler. Work that needs to block is deferred — softirqs can run on the return path after the IRQ handler returns; workqueues run later in dedicated kernel threads with full process context.

### Use Zygote to compare fork with fork-and-exec

[LineageOS's native Zygote implementation](repo:LineageOS/android/frameworks/base/core/jni/com_android_internal_os_Zygote.cpp:ForkCommon) supplies an Android example of process creation. Read it alongside [kernel_clone](kernel/fork.c:kernel_clone), then examine [GrapheneOS's Zygote dispatch](repo:GrapheneOS/platform_manifest/frameworks/base/core/java/com/android/internal/os/ZygoteConnection.java:L276) and [native fork-and-exec entry](repo:GrapheneOS/platform_manifest/frameworks/base/core/jni/com_android_internal_os_Zygote.cpp:com_android_internal_os_Zygote_nativeForkExec).

Creating a child and replacing its program image are separate operations; [do_execveat_common](fs/exec.c:do_execveat_common) explains the latter. Android decides the launch policy and prepares process state, while the kernel implements the creation and replacement mechanisms. GrapheneOS-specific kernel extensions need the matching device sources; the stock kernel guide alone cannot establish the full behavior of that launch path.

---
id: ch7
title: Chapter 7 — Communication and Cooperation
fileRecommendations:
  readingOrder:
    - path: Documentation/locking/locktypes.rst#Lock+types
      description: Locking primitives — spinlocks, mutexes, RCU
      type: docs
    - path: Documentation/RCU/whatisRCU.rst#What+is+RCU
      description: Read-Copy-Update synchronization mechanism
      type: docs
    - path: Documentation/core-api/workqueue.rst#Workqueues
      description: Workqueues — cross-context deferred work
      type: docs
    - path: Documentation/filesystems/proc.rst#L1
      description: /proc filesystem — the kernel's primary user-space window
      type: docs
    - path: Documentation/bpf/index.rst#eBPF
      description: eBPF — programmable kernel hooks
      type: docs
    - path: kernel/signal.c:do_send_sig_info
      description: Signal generation, queueing, and delivery
      type: source
    - path: kernel/futex/waitwake.c:futex_wait
      description: Fast userspace mutex — kernel-side wait/wake implementation
      type: source
    - path: kernel/sched/wait.c:prepare_to_wait_event
      description: Wait queues — the general sleep-until-event mechanism
      type: source
    - path: drivers/android/binder.c:binder_ioctl_write_read
      description: Binder ioctl transport beneath Android framework calls
      type: source
    - path: security/selinux/hooks.c:selinux_binder_transaction
      description: SELinux transaction hook beneath Android service authorization
      type: source
    - path: repo:LineageOS/android/frameworks/native/libs/binder/IPCThreadState.cpp:talkWithDriver
      description: Android native client issuing the Binder ioctl
      type: source
---

Signals are the kernel's oldest delivery mechanism. [`kill(2)`](kill(2)) requests delivery to a process or thread, and the kernel records pending signal state. Delivery happens when the target thread returns toward user mode and the signal is not blocked: [`arch/arm64/kernel/signal.c:do_notify_resume`](arch/arm64/kernel/signal.c:do_notify_resume) checks `TIF_SIGPENDING`, and the kernel either applies the default action, ignores the signal, or builds a user-space handler frame. Signal handlers run in user space and return through a signal-return system call such as [`rt_sigreturn(2)`](rt_sigreturn(2)). Each thread has its own signal mask, while process-directed signals may be delivered to an eligible thread; this is why “send” and “handle” are separate steps.

User-space mutexes are commonly built on **futexes** (fast userspace locking). A futex is a 32-bit word in user memory. User space performs the uncontended atomic state transition itself; only when it must wait or wake does [`futex(2)`](futex(2)) enter the kernel, at [`kernel/futex/waitwake.c:futex_wait`](kernel/futex/waitwake.c:futex_wait). The wait operation compares the word with an expected value and blocks only if it still matches, closing the race between “check the lock” and “go to sleep.” Threads can share a futex in their address space; separate processes can do so by placing it in shared memory such as a `MAP_SHARED` mapping. The system call provides a coordination point, not the mutex algorithm by itself.

Wait queues ([`kernel/sched/wait.c:prepare_to_wait_event`](kernel/sched/wait.c:prepare_to_wait_event)) are the general sleep mechanism inside the kernel. A subsystem declares a `wait_queue_head_t`; a task calls `wait_event()` to sleep until a condition is true; another path calls `wake_up()` to wake waiters. Block I/O completion, network data arrival, and pipe writes all follow this pattern.

The modern kernel provides distinct user-space communication channels: `/proc` exposes per-process and system state as a synthetic filesystem; `ioctl` is a device-specific escape hatch; `mmap` creates shared memory regions without copying; eBPF lets user space attach verified programs to thousands of kernel tracepoints and hooks, without loading a kernel module.

### Worked bridge: Android Binder and kernel SELinux

[GrapheneOS's Binder client](repo:GrapheneOS/platform_manifest/frameworks/native/libs/binder/IPCThreadState.cpp:talkWithDriver) and [LineageOS's client](repo:LineageOS/android/frameworks/native/libs/binder/IPCThreadState.cpp:talkWithDriver) issue BINDER_WRITE_READ ioctl requests. Match the structures in [the Binder UAPI](include/uapi/linux/android/binder.h), then follow [binder_ioctl](drivers/android/binder.c:binder_ioctl) → [binder_ioctl_write_read](drivers/android/binder.c:binder_ioctl_write_read) → write-command processing and [binder_transaction](drivers/android/binder.c:binder_transaction). A single ioctl can exchange a stream of commands; it does not necessarily represent one application method call.

The driver invokes security hooks as part of transaction handling. [selinux_binder_transaction](security/selinux/hooks.c:selinux_binder_transaction) calls [AVC permission machinery](security/selinux/avc.c:avc_has_perm). Compare that kernel decision with [GrapheneOS package-state authorization](repo:GrapheneOS/platform_manifest/frameworks/base/services/core/java/com/android/server/pm/GosPackageStatePermissions.java) or [LineageOS's preference write](repo:LineageOS/android/packages/apps/Settings/src/com/android/settings/security/screenlock/PinScramblePreferenceController.java:onPreferenceChange). Driver transport checks and service-specific operation checks protect different boundaries.

For another kernel/userspace split, follow [Bionic's mutex code](repo:LineageOS/android/bionic/libc/bionic/pthread_mutex.cpp:pthread_mutex_lock) to its wait helper and back to [futex_wait](kernel/futex/waitwake.c:futex_wait). Android's synchronization library defines the mutex behavior above the kernel primitive. These source pairs illustrate interfaces; they do not assert that the Android snapshots ship this exact Linux release.

---
id: ch8
title: Chapter 8 — I/O, Scheduling, and Virtualization
fileRecommendations:
  readingOrder:
    - path: Documentation/block/blk-mq.rst#Request+queues
      description: Block layer — request queues and I/O schedulers
      type: docs
    - path: Documentation/core-api/dma-api.rst#L1
      description: DMA API — device memory transfers without the CPU
      type: docs
    - path: Documentation/core-api/timekeeping.rst#L1
      description: Kernel time sources and timer subsystem
      type: docs
    - path: Documentation/arm64/memory.rst#Memory+Layout
      description: arm64 architecture documentation
      type: docs
    - path: Documentation/virt/kvm/index.rst#KVM
      description: KVM — hardware-assisted virtualization
      type: docs
    - path: Documentation/virt/kvm/api.rst#The+KVM+API
      description: KVM API reference
      type: docs
    - path: kernel/sched/core.c:schedule
      description: schedule() — the core dispatcher
      type: source
    - path: kernel/sched/fair.c:enqueue_task_fair
      description: CFS — vruntime, red-black tree, and load balancing
      type: source
    - path: block/blk-core.c:__submit_bio
      description: Block I/O core — submit_bio() and request dispatch
      type: source
---

I/O in the kernel is layered. A [`read(2)`](read(2)) on a regular file may find data in the **page cache** ([`mm/filemap.c:generic_file_read_iter`](mm/filemap.c:generic_file_read_iter)); on a miss it submits a `bio` (block I/O descriptor) downward through the block layer. The block layer ([`block/blk-core.c:submit_bio`](block/blk-core.c:submit_bio)) may merge and schedule requests, then dispatches to the driver via `submit_bio()`. The driver programs DMA so the device transfers data into memory owned by the kernel; an interrupt or other completion path finishes the request and can wake the sleeping task. The key user-space distinction is readiness: a descriptor being “ready” means the requested operation will not block, not that a `read(2)` must return all requested bytes.

[`poll(2)`](poll(2)) checks a supplied set of file descriptors and returns when one or more requested operations are ready, a timeout expires, or a signal interrupts the wait. The caller supplies the set again on each call, so scanning cost grows with the set size. [`epoll(7)`](epoll(7)) keeps an interest list in the kernel and maintains a ready list, allowing a wait to return the descriptors that became ready. With edge-triggered epoll, applications should use nonblocking descriptors and drain them until `EAGAIN`; otherwise an event can be missed while data remains unread. `io_uring` is a separate asynchronous interface built around submission and completion queues; it can reduce syscall frequency, but its exact syscall behavior depends on how the rings and workers are configured.

Scheduling and I/O interact constantly: a task blocked on I/O sits in `TASK_INTERRUPTIBLE`, removed from the CFS run queues. When the I/O completes the interrupt handler calls [`wake_up()`](kernel/sched/wait.c:wake_up), the task moves to `TASK_RUNNING`, and CFS will schedule it at its next opportunity.

KVM turns Linux into a Type-1 hypervisor. In VMX root mode the host kernel manages guest CPU state (`struct kvm_vcpu`). When the guest executes a privileged instruction the CPU performs a VMEXIT, saving all guest registers. KVM inspects the exit reason, emulates or delegates to user-space QEMU, and resumes the guest with `VMRESUME` — all transparent to the guest OS.

### Continue a graphics ownership question into Android

[DMA-buffer export](drivers/dma-buf/dma-buf.c:dma_buf_export) and [mapping](drivers/dma-buf/dma-buf.c:dma_buf_mmap) introduce a kernel interface for shared device buffers. Compare the ownership concepts with [LineageOS BufferQueueProducer](repo:LineageOS/android/frameworks/native/libs/gui/BufferQueueProducer.cpp) and [GrapheneOS SurfaceFlinger](repo:GrapheneOS/platform_manifest/frameworks/native/services/surfaceflinger/SurfaceFlinger.cpp). The comparison identifies layers to investigate; the HAL and device driver determine the actual buffer path, so a shared-buffer concept is not proof of a direct call between these files.

---
id: ch10
title: Chapter 9 — RTLinux and Real-Time Linux
fileRecommendations:
  readingOrder:
    - path: Documentation/scheduler/sched-rt-group.rst
      description: Real-time scheduling bandwidth and group controls
      type: docs
    - path: Documentation/scheduler/sched-deadline.rst
      description: Deadline scheduling model and admission constraints
      type: docs
    - path: Documentation/locking/locktypes.rst
      description: Lock semantics, including differences under PREEMPT_RT
      type: docs
    - path: Documentation/locking/rt-mutex-design.rst
      description: Priority inheritance and RT-mutex design
      type: docs
    - path: kernel/sched/rt.c
      description: Linux FIFO and round-robin real-time scheduling class
      type: source
    - path: kernel/locking/rtmutex.c
      description: Priority-inheritance locking infrastructure
      type: source
    - path: kernel/irq/manage.c
      description: Interrupt registration and threaded interrupt handling
      type: source
---

### RTLinux Is a Specific Historical Architecture

Real-time computing asks whether a result arrives before its deadline, not whether average throughput is high. Historical **RTLinux** placed a small real-time executive beneath Linux. That layer controlled hardware interrupts and ran real-time tasks ahead of Linux; Linux ran as its lowest-priority background activity. Linux interrupt masking was virtualized so ordinary kernel critical sections could not prevent the real-time layer from handling its own interrupts.

This split created two execution environments. The real-time side handled deadline-sensitive work and exchanged data with Linux through explicit communication mechanisms such as FIFOs. Calling arbitrary Linux services from that path would reintroduce the delays the split was designed to avoid. RTLinux is not the name of Linux's real-time scheduler, and its executive is not part of the vanilla v6.1 source tree used by this guide.

### PREEMPT_RT Changes Linux Itself

**PREEMPT_RT** follows a different design: make more Linux execution preemptible, move most interrupt handling into schedulable threads, and replace eligible spinning locks with priority-inheritance-aware sleeping locks. The application remains within Linux's task and system-call model. Raw spinlocks and low-level interrupt paths still impose nonpreemptible regions.

Read [lock type semantics](Documentation/locking/locktypes.rst) before assuming that a lock behaves the same across configurations. Then connect [RT-mutex priority inheritance](Documentation/locking/rt-mutex-design.rst) to [threaded interrupt handling](kernel/irq/manage.c). Inheritance lets a lock holder make progress on behalf of a higher-priority waiter; it does not remove blocking or bound every driver operation.

This guide is pinned to **vanilla Linux v6.1**. It contains RT-related infrastructure, but a full PREEMPT_RT setup for that kernel generation requires the matching external RT patch set. Mainline integration reached Linux 6.12 for supported architectures. Do not read the presence of RT-mutex code in v6.1 as evidence that this snapshot is a fully RT-patched kernel.

### Scheduling Policy Is Only Part of the Deadline

Linux supports `SCHED_FIFO` and `SCHED_RR` through [the real-time scheduler class](kernel/sched/rt.c), including without PREEMPT_RT. FIFO runs eligible tasks by priority without a round-robin time slice; RR adds time slicing among equal-priority tasks. [Real-time bandwidth controls](Documentation/scheduler/sched-rt-group.rst) can throttle execution, so priority alone does not describe CPU availability.

`SCHED_DEADLINE` uses runtime, deadline, and period parameters with admission control, as described in [the deadline scheduler documentation](Documentation/scheduler/sched-deadline.rst). Neither selecting a policy nor reserving CPU time proves an end-to-end hardware deadline. Account for page faults, lock contention, interrupt latency, firmware interference, driver behavior, and I/O.

Trace a periodic control loop from timer or device interrupt to task wakeup, computation, and output. Prefault and lock required memory, inspect scheduling and IRQ priorities, and measure wakeup latency under representative load with tools such as cyclictest. Treat the largest observed delay as measurement evidence, not a proof of the worst possible delay.

---
id: ch9
title: Chapter 10 — Where to Go Next
fileRecommendations:
  readingOrder:
    - path: Documentation/process/howto.rst#how-to-participate-in-the-linux-community
      description: How to contribute patches to the Linux kernel
      type: docs
    - path: Documentation/admin-guide/README.rst#Linux+kernel+administration
      description: Linux kernel administration documentation
      type: docs
    - path: Documentation/kernel-hacking/hacking.rst#Rules+and+guidelines
      description: Kernel hacking guide — rules and patterns for contributors
      type: docs
    - path: Documentation/kbuild/kbuild.rst#Introduction
      description: Kernel build system — Kconfig, Makefiles, modules
      type: docs
    - path: arch/
      description: Contains architecture entry code, exception handling, and platform-specific kernel glue.
      type: directory
    - path: kernel/
      description: Contains core task, scheduler, signal, time, and synchronization code.
      type: directory
    - path: mm/
      description: Contains virtual memory, page cache, allocation, reclaim, and fault handling.
      type: directory
    - path: fs/
      description: Contains VFS, filesystems, path lookup, and file operation implementations.
      type: directory
    - path: drivers/
      description: Contains hardware-facing device drivers and bus-specific integration code.
      type: directory
    - path: net/
      description: Contains network stack protocols, sockets, packet paths, and subsystem glue.
      type: directory
    - path: tools/
      description: Contains user-space tools for tracing, performance analysis, testing, and BPF work.
      type: directory
---

The mental model from these chapters — kernel as a reactive system, memory as tracked responsibility, execution as context-switching over shared code — makes the source tree navigable. Each subsystem now has a clear owner and a clear interface.

Don't read linearly. Pick a specific path — a syscall, a page fault, an IRQ — and trace it from user space to hardware and back. Each complete trace illuminates a different cross-section of the tree.

For contributing: [`Documentation/process/howto.rst#How+to+participate+in+the+Linux+community`](Documentation/process/howto.rst#How+to+participate+in+the+Linux+community) covers the patch workflow. [`scripts/checkpatch.pl:checkpatch`](scripts/checkpatch.pl:checkpatch) validates style before submission. The mailing lists (`linux-kernel`, subsystem-specific lists) are the primary review forum — there is no GitHub PR workflow for mainline Linux.

The kernel cannot be understood through documentation, code, or runtime behavior alone. Alignment between intent, implementation, and observed behavior is what makes the system legible. These chapters supply the intent; the source is right there.
