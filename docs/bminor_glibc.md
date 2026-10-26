---
curatedRepoId: glibc-2.39
owner: bminor
repo: glibc
revision: glibc-2.39
guideId: glibc-guide
name: GNU C Library (glibc) In The Mind
description: Understanding glibc Before Code
defaultOpenIds:
  - ch1
  - ch2
  - ch3
  - ch4
  - ch5
  - ch6
  - ch7
---

# GNU C Library (glibc) In The Mind

Follow glibc 2.39 as a user-space runtime chosen by a particular program build. This guide connects its APIs to CPython and Linux without assuming that every Linux program uses glibc or that every library call becomes a syscall. Architecture-specific examples use AArch64; the companion sources are independently pinned to CPython 3.14.0 and Linux 6.1.

---
id: ch1
title: Chapter 1 — The C Library Is a Platform Choice
fileRecommendations:
  readingOrder:
    - path: INSTALL
      description: Build requirements and supported configuration
      type: docs
    - path: sysdeps/aarch64/start.S
      description: Application entry after dynamic-loader handoff
      type: source
    - path: csu/libc-start.c:__libc_start_main
      description: C runtime startup and application main
      type: source
    - path: sysdeps/unix/sysv/linux/read.c:__libc_read
      description: A cancellation-aware Linux read wrapper
      type: source
---

glibc implements C-library functions, POSIX APIs, runtime startup, and the dynamic loader for programs built to use it. A Linux process can instead use musl, Bionic, another runtime's direct syscall paths, or no conventional libc. A program's main function belongs to that program; glibc startup can arrange its invocation without implementing its body.

Keep three boundaries separate. A library API may do all its work in user space, a wrapper may cross into the kernel, and the kernel then dispatches to the operation's implementation. Allocator reuse, string scanning, and buffered stream operations need not enter the kernel for every call.

For a descriptor read on a glibc-linked AArch64 Linux build, follow [__libc_read](sysdeps/unix/sysv/linux/read.c:__libc_read), [architecture syscall macros](sysdeps/unix/sysv/linux/aarch64/sysdep.h), Linux [exception entry](repo:torvalds/linux/arch/arm64/kernel/entry-common.c:el0t_64_sync_handler), [dispatch](repo:torvalds/linux/arch/arm64/kernel/syscall.c:do_el0_svc), and [ksys_read](repo:torvalds/linux/fs/read_write.c:ksys_read). The wrapper and kernel endpoint must describe the same operation.

For formatted output, choose a different route: [__printf](stdio-common/printf.c:__printf) → [formatting](stdio-common/vfprintf-internal.c:__vfprintf_internal) → [FILE-backed output](libio/fileops.c) → [__libc_write](sysdeps/unix/sysv/linux/write.c:__libc_write) → Linux [ksys_write](repo:torvalds/linux/fs/read_write.c:ksys_write). Buffering can defer the write, compilers can replace a simple printf with another function, and the descriptor can name a pipe or file instead of a terminal. Chapter 7 follows those distinctions.

The source pins in the companion guides are glibc 2.39, Linux 6.1, and CPython 3.14.0. They provide independently versioned reading examples, not proof that a running interpreter uses those components. Record architecture, linkage, compiler options, runtime configuration, and the actual kernel when testing a binary.

---
id: ch2
title: Chapter 2 — Read Wrappers, Cancellation, and Kernel Entry
fileRecommendations:
  readingOrder:
    - path: sysdeps/unix/sysv/linux/read.c:__libc_read
      description: Read result and cancellation wrapper
      type: source
    - path: sysdeps/unix/sysdep.h:SYSCALL_CANCEL
      description: Cancellation-aware syscall macro
      type: source
    - path: sysdeps/unix/sysv/linux/aarch64/sysdep.h
      description: AArch64 inline syscall conventions
      type: source
    - path: sysdeps/unix/sysv/linux/aarch64/syscall.S
      description: Generic syscall function with an explicit syscall-number argument
      type: source
    - path: sysdeps/unix/sysv/linux/syscalls.list
      description: Inputs for generated syscall wrappers
      type: source
---

The pinned [read implementation](sysdeps/unix/sysv/linux/read.c:__libc_read) returns SYSCALL_CANCEL with the read operation and its arguments. [The cancellation macro](sysdeps/unix/sysdep.h:SYSCALL_CANCEL) handles the required pthread cancellation behavior around the syscall. Replacing it with a bare inline syscall erases a semantic part of this API.

That cancellation mechanism differs from signal interruption. A failed read can return minus one with errno set, including EINTR when interrupted. Whether the caller retries belongs to the caller's contract. [CPython's _Py_read](repo:python/cpython/Python/fileutils.c:_Py_read), for example, checks Python signal handling and retries an interruption only when no Python exception stops the retry.

The AArch64 [inline syscall macros](sysdeps/unix/sysv/linux/aarch64/sysdep.h) place arguments and the operation number in the ABI-defined registers before executing the trap instruction. [syscall.S](sysdeps/unix/sysv/linux/aarch64/syscall.S) implements the separate variadic syscall interface, which receives the syscall number as an ordinary argument and rearranges registers. Named wrappers such as read can use their own inline machinery.

On the Linux side, [do_el0_svc](repo:torvalds/linux/arch/arm64/kernel/syscall.c:do_el0_svc) dispatches the number to a handler. [ksys_read](repo:torvalds/linux/fs/read_write.c:ksys_read) resolves the file descriptor and enters the VFS. Pipes, sockets, devices, and regular files then have their own read implementations.

Some Linux syscalls have named libc wrappers; others require the generic syscall API or another interface. [syscalls.list](sysdeps/unix/sysv/linux/syscalls.list) is an input to wrapper generation, alongside handwritten and architecture-selected implementations, rather than a complete promise of one wrapper per kernel syscall. Conventional errno-returning wrappers translate kernel errors into their C API result; pthread APIs can instead return an error number directly.

---
id: ch3
title: Chapter 3 — Follow Allocator Reuse before Kernel Memory Requests
fileRecommendations:
  readingOrder:
    - path: malloc/malloc.c:__libc_malloc
      description: Public allocation entry and tcache path
      type: source
    - path: malloc/malloc.c:_int_malloc
      description: Arena allocation machinery
      type: source
    - path: malloc/malloc.c:sysmalloc
      description: Obtaining more allocator backing memory
      type: source
    - path: malloc/arena.c
      description: Arena selection and management
      type: source
    - path: sysdeps/unix/sysv/linux/brk.c:__brk
      description: Program-break syscall interface
      type: source
    - path: sysdeps/unix/sysv/linux/mmap64.c:__mmap64
      description: Mapping syscall interface
      type: source
---

Start with [__libc_malloc](malloc/malloc.c:__libc_malloc), including its tcache handling, then [the arena allocator](malloc/malloc.c:_int_malloc). A cached chunk or space already managed by an arena can serve the allocation without a new mapping. Fastbins, small bins, large bins, the unsorted bin, and the top chunk serve different roles; they are not one universal linear list searched in the same way for every request.

Use the source's alignment and size-class macros instead of memorizing one table of byte ranges. They depend on the ABI and distinguish requested bytes from aligned chunk sizes and metadata. [Arena management](malloc/arena.c) also does not guarantee a private arena for every thread: threads can share arenas, and per-thread tcache is a separate layer.

When existing storage cannot serve a request, [sysmalloc](malloc/malloc.c:sysmalloc) can get more backing memory. The main arena commonly uses the program break through [__brk](sysdeps/unix/sysv/linux/brk.c:__brk); other paths use [mmap](sysdeps/unix/sysv/linux/mmap64.c:__mmap64). Mapping thresholds, limits, reuse opportunities, tunables, and allocation history affect the choice. The initial mmap threshold is not a rule that every request above a fixed size must create a separate mapping.

[__libc_free](malloc/malloc.c:__libc_free) can return memory to a cache or arena. Mapped chunks have an unmapping path, while releasing arena backing depends on allocator conditions. Object destruction, free, unmap, and a drop in resident memory are distinct observations. Linux [mapping management](repo:torvalds/linux/mm/mmap.c:do_mmap) and [fault handling](repo:torvalds/linux/mm/memory.c:handle_mm_fault) explain another distinction: ordinary mappings can get physical backing on later access.

For CPython, distinguish this allocator from [pymalloc's arena allocator](repo:python/cpython/Objects/obmalloc.c:_PyMem_ArenaAlloc). That allocator can call mmap directly for an arena, while larger pymalloc requests can use [the raw malloc route](repo:python/cpython/Objects/obmalloc.c:_PyMem_RawMalloc). Free-threaded object allocation has a mimalloc route. CPython object allocation does not invariably call glibc malloc.

The old malloc hooks are not a supported interception recipe for the normal glibc 2.39 allocator. [hooks.c](malloc/hooks.c) retains compatibility symbols; that does not restore their former effect on ordinary allocations. For investigation, use source-level debugging, appropriate allocator diagnostics, and scoped interposition where supported. Report performance only with a workload and measurement setup; source structure alone cannot establish fixed nanosecond timings.

---
id: ch4
title: Chapter 4 — Resolve String Implementations on the Selected Architecture
fileRecommendations:
  readingOrder:
    - path: string/strlen.c:__strlen
      description: Portable word-at-a-time implementation
      type: source
    - path: sysdeps/aarch64/multiarch/strlen.c
      description: Actual AArch64 strlen IFUNC selector
      type: source
    - path: sysdeps/aarch64/multiarch/strlen_asimd.S
      description: AArch64 SIMD implementation
      type: source
    - path: sysdeps/aarch64/multiarch/ifunc-impl-list.c:__libc_ifunc_impl_list
      description: Implementation enumeration for tooling and tests
      type: source
    - path: sysdeps/aarch64/multiarch/memcpy_sve.S
      description: An architecture-specific copy implementation
      type: source
---

A function name does not identify a single machine implementation across glibc builds. A compiler can fold or inline a call, the sysdeps build selection can choose a platform implementation, and an IFUNC resolver can choose a supported variant at relocation or binding time.

For AArch64 strlen, inspect [the selector](sysdeps/aarch64/multiarch/strlen.c). Its pinned expression chooses the generic variant for its MTE condition and the ASIMD variant otherwise. Then read [the SIMD implementation](sysdeps/aarch64/multiarch/strlen_asimd.S). [ifunc-impl-list.c](sysdeps/aarch64/multiarch/ifunc-impl-list.c:__libc_ifunc_impl_list) enumerates implementations for tooling and tests; production selection uses the function-specific resolver.

The portable [string/strlen.c](string/strlen.c:__strlen) uses word-at-a-time operations. The word size follows the build rather than being universally eight bytes. Distinguish the string's semantic terminator search from the machine implementation's alignment, page-boundary handling, and vector operations.

[memcpy_sve.S](sysdeps/aarch64/multiarch/memcpy_sve.S) is a separate copy implementation, not a call to memset or a guarantee that a machine supporting SVE will always select that variant. Compare the corresponding selector and target capability checks before attributing observed code to a CPU feature.

The loader's binding configuration affects when a resolver runs. Avoid claiming that every IFUNC resolves before main or that later calls have zero overhead: relocation, lazy binding where applicable, indirection, compiler choices, and the call site's code all matter. A useful experiment records the resolved symbol address and disassembly for the actual binary and architecture.

---
id: ch5
title: Chapter 5 — Separate ELF Startup from dlopen
fileRecommendations:
  readingOrder:
    - path: elf/rtld.c:_dl_start
      description: Loader initialization after ELF-interpreter entry
      type: source
    - path: elf/dl-load.c:_dl_map_object
      description: Shared-object loading
      type: source
    - path: elf/dl-reloc.c:_dl_relocate_object
      description: Relocation processing
      type: source
    - path: elf/dl-lookup.c:_dl_lookup_symbol_x
      description: Symbol lookup across scopes
      type: source
    - path: dlfcn/dlopen.c:___dlopen
      description: Public dynamic loading boundary
      type: source
    - path: elf/dl-open.c:_dl_open
      description: Runtime object loading into an existing process
      type: source
---

For an ELF executable with PT_INTERP, Linux [load_elf_binary](repo:torvalds/linux/fs/binfmt_elf.c:load_elf_binary) maps the executable and its interpreter, then enters the interpreter. With the glibc loader, [_dl_start](elf/rtld.c:_dl_start) begins loader initialization. Dependency loading, [symbol lookup](elf/dl-lookup.c:_dl_lookup_symbol_x), [relocation](elf/dl-reloc.c:_dl_relocate_object), TLS setup, and initialization prepare the process for application startup.

On AArch64, the application reaches [its _start](sysdeps/aarch64/start.S) after loader handoff; [__libc_start_main](csu/libc-start.c:__libc_start_main) then arranges invocation of the program's main. [CPython's main](repo:python/cpython/Programs/python.c:main) calls Py_BytesMain on the Unix path. Static executables and static PIE need separate analysis; do not insert the dynamic-interpreter stage into every ELF program.

Runtime extension loading follows a different entry. [CPython's shared-extension lookup](repo:python/cpython/Python/dynload_shlib.c:_PyImport_FindSharedFuncptr) calls [dlopen](dlfcn/dlopen.c:___dlopen), which enters [_dl_open](elf/dl-open.c:_dl_open), then performs dlsym lookup for the initialization symbol. [Mapping machinery](elf/dl-load.c:_dl_map_object) may reuse an existing object or load one and its dependencies. This occurs in the existing process, with no new execve and no second invocation of the application's main.

PLT and GOT machinery supports dynamic symbol binding. Some bindings can be deferred where configuration allows, while eager binding resolves them earlier. Source-level linking relationships, mapped objects, and actual bound symbols are different observations to inspect. Use readelf on the real executable and LD_DEBUG on a glibc development run to examine dependencies, relocations, and bindings; exact results depend on the binary and environment.

---
id: ch6
title: Chapter 6 — Trace pthread Creation and Synchronization
fileRecommendations:
  readingOrder:
    - path: nptl/pthread_create.c:__pthread_create_2_1
      description: POSIX thread creation and child start routine
      type: source
    - path: sysdeps/unix/sysv/linux/clone-internal.c:__clone_internal
      description: clone3 attempt and clone fallback
      type: source
    - path: nptl/pthread_mutex_lock.c:___pthread_mutex_lock
      description: Mutex types and locking paths
      type: source
    - path: nptl/pthread_mutex_unlock.c:___pthread_mutex_unlock
      description: Mutex release and wakeup decisions
      type: source
    - path: sysdeps/nptl/futex-internal.h
      description: Kernel-assisted waiting and wakeup
      type: source
    - path: sysdeps/aarch64/nptl/tls.h
      description: AArch64 TLS layout and thread-pointer details
      type: source
---

[pthread_create](nptl/pthread_create.c:__pthread_create_2_1) arranges stack and thread-descriptor resources, TLS information, attributes, and the child start routine. Its creation helper calls [__clone_internal](sysdeps/unix/sysv/linux/clone-internal.c:__clone_internal). On applicable paths the wrapper tries clone3, then falls back to clone on ENOSYS. Both reach the relevant Linux clone-family syscall and [kernel_clone](repo:torvalds/linux/kernel/fork.c:kernel_clone) with thread-sharing flags.

The child invokes the function supplied to pthread_create. For [CPython's POSIX adapter](repo:python/cpython/Python/thread_pthread.h:PyThread_start_joinable_thread), that function leads to [the Python thread bootstrap](repo:python/cpython/Modules/_threadmodule.c:thread_run). Thread-state attachment and GIL rules apply before the Python callable executes. A new kernel task alone does not establish parallel bytecode execution under a shared GIL.

[Mutex locking](nptl/pthread_mutex_lock.c:___pthread_mutex_lock) distinguishes mutex types and runtime conditions. Ordinary uncontended locking can complete using user-space atomics; a contended path can wait using [futex operations](sysdeps/nptl/futex-internal.h). Unlock may need to wake a waiter, but neither every lock nor every unlock guarantees a syscall. Robust, recursive, priority-related, and other mutex cases need their own paths.

pthread APIs commonly return error numbers directly instead of adopting the minus-one-plus-errno convention used by read. Keep cancellation, signal handling, lock ownership, and thread termination separate when interpreting a failure. Record TLS and architecture details when inspecting the low-level ABI, and avoid treating every observed futex operation in Python as a GIL operation.

---
id: ch7
title: Chapter 7 — Distinguish C stdio Buffers from Python I/O Buffers
fileRecommendations:
  readingOrder:
    - path: libio/libio.h
      description: Stream flags and internal interfaces
      type: source
    - path: libio/fileops.c
      description: File-backed buffering, flush, and write paths
      type: source
    - path: libio/iofwrite.c:_IO_fwrite
      description: fwrite through the stream interface
      type: source
    - path: stdio-common/printf.c:__printf
      description: Formatted-output entry
      type: source
    - path: stdio-common/vfprintf-internal.c:__vfprintf_internal
      description: Formatting engine
      type: source
    - path: sysdeps/unix/sysv/linux/write.c:__libc_write
      description: Cancellation-aware descriptor write
      type: source
---

A C FILE stream owns buffering and stream state. [printf](stdio-common/printf.c:__printf) delegates formatting to [__vfprintf_internal](stdio-common/vfprintf-internal.c:__vfprintf_internal), while [fwrite](libio/iofwrite.c:_IO_fwrite) submits already-supplied bytes to the stream interface. [File-backed operations](libio/fileops.c) handle buffers, flushes, descriptor writes, and error state.

A formatting call does not guarantee an immediate syscall or visible terminal output. Buffering mode, available space, flush operations, stream orientation, errors, and the destination all affect what happens. The final descriptor-write boundary is [__libc_write](sysdeps/unix/sysv/linux/write.c:__libc_write), followed on Linux by the write handler and [ksys_write](repo:torvalds/linux/fs/read_write.c:ksys_write). That path is distinct from read and need not end at hardware synchronously.

Python's [BufferedReader implementation](repo:python/cpython/Modules/_io/bufferedio.c) supplies its own buffering above [raw FileIO](repo:python/cpython/Modules/_io/fileio.c). Ordinary Python open/read operations do not universally pass through C fread or a glibc FILE buffer. [os.read](repo:python/cpython/Modules/posixmodule.c:os_read_impl) goes through CPython's descriptor helper instead. Embedding applications and extensions can still use C stdio, so identify the API actually invoked.

For a Linux experiment, compare libc-call observations with read/write syscalls and verify whether the compiler retained the source call. A missing printf in a library-call trace can result from compiler transformation; a missing write can result from buffering. A short read or partial write is an API result to handle, not proof that formatting or buffering succeeded.
