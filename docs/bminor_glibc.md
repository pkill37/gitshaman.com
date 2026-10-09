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

## Understanding glibc Before Code

> This isn't a guide to using the C library. It's an effort to understand the foundation of every program on Linux.

The GNU C Library (glibc) is the critical bridge between user programs and the Linux kernel. It provides the system call interface, implements the C standard library, and offers POSIX-compliant APIs that nearly every Linux program depends on. Understanding glibc means understanding how user-space programs interact with the kernel, how memory is managed, how threads work, and how standard functions are optimized for performance.

Every time you call `printf()`, `malloc()`, `pthread_create()`, or even `main()`, you're executing glibc code. It's the invisible foundation that makes Linux programming possible.

**glibc powers every Linux program. Let's understand how it works.**

---
id: ch1
title: Chapter 1 — Introduction to glibc
fileRecommendations:
  readingOrder:
    - path: manual/
      description: glibc manual source
      type: directory
    - path: INSTALL
      description: Build and installation instructions
      type: docs
    - path: sysdeps/aarch64/start.S
      description: Program startup — _start assembly entry point
      type: source
    - path: csu/libc-start.c:__libc_start_main
      description: __libc_start_main — sets up runtime and calls main()
      type: source
    - path: sysdeps/unix/sysv/linux/aarch64/syscall.S
      description: AArch64 syscall assembly wrapper
      type: source
    - path: stdio-common/vfprintf-internal.c
      description: Core printf formatting (about 1,570 lines)
      type: source
    - path: elf/rtld.c:_dl_start
      description: Dynamic linker / runtime loader (about 3,000 lines)
      type: source
---

### The Bridge Between User Space and Kernel

glibc serves these critical roles:

- **System call wrapper**: Provides C functions that invoke Linux syscalls
- **Standard library**: Implements C11/C17 standard functions
- **POSIX layer**: Implements POSIX specifications (threads, IPC, etc.)
- **Optimization layer**: Provides architecture-specific optimized code
- **Dynamic linker**: `elf/rtld.c` implements the runtime loader and links shared libraries

**The Call Chain:**

```
Your Code: printf("Hello\n");
    ↓
glibc: printf() in stdio/printf.c
    ↓
glibc: vfprintf() - formatting logic
    ↓
glibc: write() wrapper in sysdeps/unix/sysv/linux/
    ↓
Kernel: syscall entry (arch/arm64/kernel/entry.S)
    ↓
Kernel: sys_write() in fs/read_write.c
    ↓
Hardware: Terminal output
```

The last two steps cross into the kernel: glibc's [`read` wrapper](repo:bminor/glibc/sysdeps/unix/sysv/linux/read.c:__libc_read) prepares the user-space call, while Linux's [`ksys_write`](repo:torvalds/linux/fs/read_write.c:ksys_write) handles the corresponding kernel-side write path. Following both links makes the system-call boundary concrete instead of treating libc as a black box.

### Key Concepts Deep Dive

**1. System Call Wrappers**

Every Linux system call has a glibc wrapper. Example: `read()`:

```c
// User calls:
ssize_t n = read(fd, buf, sizeof(buf));

// glibc wrapper (sysdeps/unix/sysv/linux/read.c):
ssize_t __libc_read(int fd, void *buf, size_t nbytes) {
    return INLINE_SYSCALL_CALL(read, fd, buf, nbytes);
}
weak_alias(__libc_read, read)
```

**The syscall happens through:**

```assembly
; AArch64 syscall wrapper shape (sysdeps/unix/sysv/linux/aarch64/syscall.S)
uxtw    x8, w0      ; syscall number moves to x8
mov     x0, x1      ; arg1: fd
mov     x1, x2      ; arg2: buf
mov     x2, x3      ; arg3: count
svc     0x0         ; enter kernel
ret
```

**2. Standard C Library Implementation**

glibc implements all standard C functions:

- **stdio.h**: Buffered I/O (`printf`, `fopen`, `fread`)
- **string.h**: String operations (`strcpy`, `strlen`, `memcpy`)
- **stdlib.h**: General utilities (`malloc`, `qsort`, `atoi`)
- **math.h**: Mathematical functions (`sin`, `cos`, `sqrt`)

**Example: strlen() optimization**

```c
// Naive implementation:
size_t strlen(const char *s) {
    const char *p = s;
    while (*p) p++;
    return p - s;
}

// Optimized AArch64 SIMD version (sysdeps/aarch64/multiarch/strlen_asimd.S):
// - Checks the first 32 bytes early
// - Uses Advanced SIMD comparisons for long strings
// - Uses cmeq/uminp-style vector tests to find NUL bytes in parallel
```

**3. POSIX Compliance**

POSIX defines a standard interface for Unix-like systems. glibc implements:

- **Threads (pthreads)**: `pthread_create`, `pthread_mutex_lock`
- **File I/O**: `open`, `read`, `write`, `fcntl`
- **Processes**: `fork`, `exec`, `wait`
- **Signals**: `signal`, `sigaction`, `kill`
- **IPC**: Pipes, message queues, shared memory

**4. Threading Support (NPTL)**

Native POSIX Thread Library (NPTL) is glibc's threading implementation:

- **1:1 threading model**: One kernel thread per pthread
- **Futex-based locking**: Fast user-space mutexes
- **Thread-local storage (TLS)**: Per-thread data
- **Async-signal-safe**: Careful signal handling in threads

**Practical Exercise:**

```bash
# Find how open() is implemented
grep -r "open" sysdeps/unix/sysv/linux/syscalls.list
# Study: sysdeps/unix/sysv/linux/open.c
```

**Practical Exercise:**

```c
// Understand buffering
setbuf(stdout, NULL);  // Disable buffering
printf("Test\n");      // Immediately writes (no buffer)
```

---
id: ch2
title: Chapter 2 — System Call Interface
fileRecommendations:
  readingOrder:
    - path: sysdeps/unix/sysv/linux/syscalls.list
      description: List of all Linux syscall wrappers
      type: source
    - path: sysdeps/unix/sysv/linux/aarch64/syscall.S
      description: AArch64 syscall assembly implementation
      type: source
    - path: sysdeps/unix/syscall-template.S
      description: Template for generated syscall wrappers
      type: source
    - path: sysdeps/unix/sysv/linux/read.c:__libc_read
      description: "Example: read() syscall wrapper"
      type: source
---

glibc provides the interface between user programs and the Linux kernel through system calls.

### System Call Wrappers

- **Direct syscalls**: Functions that directly invoke kernel syscalls
- **Cancellation points**: Functions that can be interrupted
- **Error handling**: Converting errno to appropriate error codes

---
id: ch3
title: Chapter 3 — Memory Management Deep Dive
fileRecommendations:
  readingOrder:
    - path: malloc/malloc.c:__libc_malloc
      description: Main allocator (about 6,000 lines) — the whole implementation
      type: source
    - path: malloc/arena.c
      description: Per-thread arena management
      type: source
    - path: malloc/malloc-internal.h
      description: Internal macros, chunk structure, bin definitions
      type: source
    - path: malloc/hooks.c
      description: malloc hooks for debugging and instrumentation
      type: source
---

glibc's malloc is one of the most sophisticated memory allocators in existence. Understanding it reveals fundamental concepts in systems programming: memory organization, performance optimization, thread safety, and fragmentation management.

Large allocations reach the kernel's virtual-memory machinery. Compare glibc's [`__libc_malloc`](malloc/malloc.c:__libc_malloc) with Linux's [`vm_mmap_pgoff`](repo:torvalds/linux/mm/mmap.c:vm_mmap_pgoff) to follow that handoff from a user-space allocator to a process mapping.

### malloc Philosophy: Balancing Speed, Space, and Safety

The allocator must balance competing goals:

- **Speed**: Allocations must be fast (nanoseconds)
- **Space efficiency**: Reduce fragmentation and overhead
- **Thread safety**: Support concurrent allocations
- **Scalability**: Scale as thread count grows
- **Security**: Resist heap exploitation

### Core Concepts

**1. Chunks: The Basic Unit**

Memory is managed in chunks. Each chunk has a header:

```c
// Simplified chunk structure (from malloc/malloc.c)
struct malloc_chunk {
    size_t prev_size;  // Size of previous chunk (if free)
    size_t size;       // Size of this chunk (includes header)

    // For free chunks only:
    struct malloc_chunk *fd;  // Forward pointer (next in bin)
    struct malloc_chunk *bk;  // Back pointer (previous in bin)

    // User data starts here for allocated chunks
};
```

**Chunk Header Details:**

- `size` field includes 3 flag bits in low bits:
  - `PREV_INUSE` (0x1): Previous chunk is allocated
  - `IS_MMAPPED` (0x2): Chunk obtained via mmap
  - `NON_MAIN_ARENA` (0x4): Chunk from non-main arena
- Smallest chunk size: 32 bytes (on 64-bit)
- Chunks are always 16-byte aligned (on 64-bit)

**Example Chunk Layout:**

```
Allocated chunk:
+------------------+
| prev_size        | (used by previous chunk if it's free)
+------------------+
| size | flags     | (size includes header)
+------------------+
| user data        |
|   ...            |
+------------------+

Free chunk:
+------------------+
| prev_size        |
+------------------+
| size | flags     |
+------------------+
| fd (forward)     | Pointer to next free chunk in bin
+------------------+
| bk (back)        | Pointer to prev free chunk in bin
+------------------+
| unused space     |
+------------------+
| size | flags     | (footer, copy of size)
+------------------+
```

**2. Bins: Organizing Free Chunks**

Free chunks are organized into bins (linked lists) by size:

**Fastbins (16-80 bytes on 64-bit):**

- LIFO (stack) of chunks from the latest frees
- 10 bins for sizes: 16, 24, 32, ..., 80 bytes
- No coalescing (for speed)
- Single-linked list

```c
// Fastbin allocation (simplified)
if (size <= FASTBIN_MAX_SIZE) {
    fastbin_index = size >> 4;  // Divide by 16
    chunk = fastbin[fastbin_index];
    if (chunk) {
        fastbin[fastbin_index] = chunk->fd;  // Pop from stack
        return chunk;
    }
}
```

**Small bins (< 512 bytes on 64-bit):**

- 62 bins for exact sizes
- Doubly-linked list (FIFO)
- Coalescing enabled

**Large bins (>= 512 bytes):**

- 63 bins for size ranges
- Sorted by size within each bin
- Best-fit allocation

**Unsorted bin:**

- Temporary holding area for chunks from the latest frees
- Helps reuse memory from the latest frees
- Chunks sorted into appropriate bins during allocation

**3. Arenas: Multi-threaded Memory Management**

To avoid lock contention, malloc uses separate arenas:

```c
// Main arena: Uses sbrk() to grow heap
// Thread arenas: Use mmap() for memory

struct malloc_state {
    mutex_t mutex;              // Lock for this arena
    mchunkptr bins[NBINS * 2];  // Free chunk bins
    mchunkptr top;              // Top chunk (wilderness)
    mchunkptr last_remainder;   // Last split chunk
    mfastbinptr fastbinsY[NFASTBINS];  // Fastbins
    // ... more fields
};
```

**Arena Strategy:**

- Main thread uses main arena (grows via `sbrk()`)
- Each new thread gets its own arena (up to limit)
- Arena limit: 2 _ num_cores on 32-bit, 8 _ num_cores on 64-bit
- When limit reached, threads share arenas (contention)

**4. The Top Chunk (Wilderness)**

The top chunk is the unused space at the end of the heap:

- Always the highest chunk in arena
- Source for new allocations when bins are empty
- Grows via `sbrk()` (main arena) or `mmap()` (thread arenas)
- Shrinks when large amount is free

**5. Large Allocations via mmap**

Allocations >= 128KB (default) use mmap directly:

- Bypasses arena/bin mechanism
- Each allocation is a separate mmap region
- Freed via munmap (returns memory to the OS on release)
- Avoids fragmentation in main heap

### malloc() Implementation Flow

**Allocation Path:**

```c
void* malloc(size_t size) {
    // 1. Add overhead and align
    size = (size + SIZE_SZ + MALLOC_ALIGN_MASK) & ~MALLOC_ALIGN_MASK;

    // 2. Check fastbins for small sizes
    if (size <= FASTBIN_MAX_SIZE) {
        idx = fastbin_index(size);
        if ((victim = fastbin[idx]) != NULL) {
            fastbin[idx] = victim->fd;
            return chunk2mem(victim);
        }
    }

    // 3. Check small bins for exact fit
    if (in_smallbin_range(size)) {
        idx = smallbin_index(size);
        bin = bin_at(av, idx);
        if ((victim = last(bin)) != bin) {
            unlink(victim, bck, fwd);
            return chunk2mem(victim);
        }
    }

    // 4. Large allocation? Use mmap
    if (size >= mp_.mmap_threshold) {
        void *p = mmap_malloc(size);
        if (p != NULL)
            return p;
    }

    // 5. Search unsorted bin
    while ((victim = unsorted_chunks(av)->bk) != unsorted_chunks(av)) {
        // Try to use this chunk or sort it
        if (size == chunksize(victim)) {
            unlink(victim, bck, fwd);
            return chunk2mem(victim);
        }
        // Otherwise, sort into appropriate bin
    }

    // 6. Search large bins (best fit)
    // 7. Use top chunk
    victim = av->top;
    remainder_size = chunksize(victim) - nb;
    if (remainder_size >= MINSIZE) {
        av->top = remainder;
        return chunk2mem(victim);
    }

    // 8. Extend heap via sbrk() or mmap()
    sysmalloc(nb, av);
}
```

### free() Implementation

```c
void free(void* ptr) {
    if (ptr == NULL) return;

    chunk = mem2chunk(ptr);
    size = chunksize(chunk);

    // 1. If mmaped, unmap immediately
    if (chunk_is_mmapped(chunk)) {
        munmap_chunk(chunk);
        return;
    }

    // 2. Fastbin size? Add to fastbin (no coalescing)
    if (size <= FASTBIN_MAX_SIZE) {
        fb_idx = fastbin_index(size);
        chunk->fd = fastbin[fb_idx];
        fastbin[fb_idx] = chunk;
        return;
    }

    // 3. Consolidate with adjacent free chunks
    // Backward consolidation
    if (!prev_inuse(chunk)) {
        prevsize = chunk->prev_size;
        chunk = chunk_at_offset(chunk, -prevsize);
        size += prevsize;
        unlink(chunk, bck, fwd);
    }

    // Forward consolidation
    nextchunk = chunk_at_offset(chunk, size);
    if (!inuse(nextchunk)) {
        size += chunksize(nextchunk);
        unlink(nextchunk, bck, fwd);
    }

    // 4. If consolidated chunk is large, return to OS
    if (size >= FASTBIN_CONSOLIDATION_THRESHOLD) {
        if (have_fastchunks(av))
            malloc_consolidate(av);
    }

    // 5. Add to unsorted bin
    chunk->size = size | PREV_INUSE;
    chunk->fd = unsorted_bin->fd;
    chunk->bk = unsorted_bin;
    unsorted_bin->fd = chunk;
}
```

### Advanced Features

**1. Malloc Hooks (Debugging/Instrumentation):**

```c
// Set hooks to intercept allocations
void* (*__malloc_hook)(size_t size, const void *caller);
void (*__free_hook)(void *ptr, const void *caller);

// Example usage:
void* my_malloc_hook(size_t size, const void *caller) {
    printf("Allocating %zu bytes\n", size);
    // Restore original and call
}
```

**2. Malloc Stats and Tuning:**

```c
// Get allocation statistics
struct mallinfo info = mallinfo();
printf("Total allocated: %d\n", info.uordblks);
printf("Free memory: %d\n", info.fordblks);

// Tune malloc behavior
mallopt(M_MMAP_THRESHOLD, 64 * 1024);  // Set mmap threshold
mallopt(M_TRIM_THRESHOLD, 128 * 1024); // When to return memory to OS
```

**3. Thread Cache (tcache) - Recent Addition:**

Fast per-thread caching layer (added in glibc 2.26):

- Per-thread bins for sizes 16-1032 bytes
- No locking needed (thread-local)
- LIFO allocation (stack-like)
- Up to 7 chunks per size class

### Performance Characteristics

**Allocation Performance:**

- Fastbin hit: about 10-20 ns
- Small bin hit: about 20-40 ns
- Large allocation: about 100-500 ns
- mmap allocation: about 1000-5000 ns

**Memory Overhead:**

- At least 16 bytes per allocation (header)
- Typical: 5-10% for mixed workloads
- Worst case: 50%+ with heavy fragmentation

**Practical Exercises:**

```bash
# Visualize malloc behavior
LD_PRELOAD=./malloc_trace.so ./your_program

# Study allocation patterns
strace -e brk,mmap,munmap ./your_program 2>&1 | grep -E "brk|mmap"

# Analyze heap with gdb
gdb ./program
(gdb) break malloc
(gdb) run
(gdb) print *av  # Print arena structure
(gdb) x/40x chunk  # Examine chunk memory
```

---
id: ch4
title: Chapter 4 — String and Memory Functions
fileRecommendations:
  readingOrder:
    - path: string/strlen.c:__strlen
      description: Generic (portable) strlen implementation
      type: source
    - path: sysdeps/aarch64/multiarch/strlen_asimd.S
      description: AArch64 Advanced SIMD strlen implementation
      type: source
    - path: sysdeps/aarch64/multiarch/memcpy_sve.S
      description: SVE memcpy implementation for AArch64 systems with SVE
      type: source
    - path: sysdeps/aarch64/multiarch/ifunc-impl-list.c:__libc_ifunc_impl_list
      description: AArch64 IFUNC dispatch table — maps CPU features to implementations
      type: source
    - path: sysdeps/aarch64/multiarch/memset_zva64.S
      description: AArch64 memset using DC ZVA for 64-byte zeroing blocks
      type: source
---

glibc provides architecture-optimized implementations of the C standard string and memory functions. Rather than one implementation per function, glibc ships CPU-specific variants selected at runtime based on the CPU's capabilities.


```chapter-graph
sysdeps/aarch64/multiarch/ifunc-impl-list.c -> sysdeps/aarch64/multiarch/strlen_asimd.S : IFUNC selects Advanced SIMD impl
sysdeps/aarch64/multiarch/ifunc-impl-list.c -> string/strlen.c : IFUNC selects generic fallback
sysdeps/aarch64/multiarch/memcpy_sve.S -> sysdeps/aarch64/multiarch/memset_zva64.S : AArch64 feature paths specialize memory operations
string/strlen.c -> string/strcpy.c : generic pattern shared across string functions
```

### The IFUNC Dispatch Mechanism

glibc uses GNU IFUNC (Indirect Function) to select the best implementation at program startup. The linker sets up an indirect function that the dynamic linker resolves to the optimal variant after checking AArch64 feature state such as SVE, MOPS, MTE, BTI, and DC ZVA size.

```c
// sysdeps/aarch64/multiarch/ifunc-impl-list.c (simplified)
// This table maps AArch64 feature state to implementations:
IFUNC_IMPL (i, name, strlen,
    IFUNC_IMPL_ADD (array, i, strlen, !mte,
                    __strlen_asimd)
    IFUNC_IMPL_ADD (array, i, strlen, 1,
                    __strlen_generic)
)
```

At program startup (before `main()`), the resolver runs once and patches the GOT to point directly to the best implementation. All later calls go directly to the selected function — zero overhead after the first call.

### Deep Dive: strlen Implementations

**Generic (`string/strlen.c`) — portable baseline:**

```c
// Naive byte-by-byte (conceptual)
size_t strlen(const char *str) {
    const char *s;
    for (s = str; *s; ++s);
    return s - str;
}
```

In practice, [string/strlen.c](string/strlen.c) uses word-at-a-time tricks to check 8 bytes simultaneously without SIMD.

**Advanced SIMD (`sysdeps/aarch64/multiarch/strlen_asimd.S`) — 32 bytes per loop:**

```asm
// Core idea in strlen_asimd.S
// dataq1/dataq2 hold 32 loaded bytes.
// cmeq marks zero bytes, then a reduced mask finds the first NUL.

.loop:
    ldp     q1, q2, [x1, 32]!      // load 32 bytes
    uminp   v0.16b, v1.16b, v2.16b // reduce byte lanes
    cmeq    v0.8b, v0.8b, 0        // compare with NUL
    fmov    x3, d0                 // move mask to GPR
    cbz     x3, .loop              // continue when no NUL appears
```

This checks 32 bytes per loop and keeps short-string exits fast, while avoiding unsafe unaligned page crossings.

### Deep Dive: memcpy Implementations

memcpy has more variants because its optimal strategy depends on size and available AArch64 extensions:

- **Small copies**: Avoid loop overhead, use direct scalar loads/stores
- **General copies**: Use Advanced SIMD or tuned core-specific implementations
- **SVE copies**: Use scalable vector registers where available
- **MOPS copies**: Use architectural memory operation instructions when available

```asm
// Excerpt shape from AArch64 memcpy paths
// Copy vectors from source to destination, with overlap handled by memmove.
ldp     q0, q1, [x1], 32      // load 32 bytes from src
stp     q0, q1, [x0], 32      // store 32 bytes to dst
ldp     q2, q3, [x1], 32
stp     q2, q3, [x0], 32
```

### DC ZVA and MOPS: AArch64 Memory Operations

AArch64 systems expose memory-operation features through the hardware capability state. glibc uses IFUNC selection to choose paths such as DC ZVA zeroing, SVE copy loops, or MOPS implementations when the CPU reports support.

```asm
// memset_zva64.S zeroing shape
// DC ZVA zeros a whole cache block selected by the implementation.
dc      zva, x0          // zero block at destination address
add     x0, x0, 64       // advance by the selected ZVA block size
```

### Trace Order

1. Start with [sysdeps/aarch64/multiarch/ifunc-impl-list.c](sysdeps/aarch64/multiarch/ifunc-impl-list.c) — understand the dispatch table
2. Read [string/strlen.c](string/strlen.c) — the portable baseline
3. Study [sysdeps/aarch64/multiarch/strlen_asimd.S](sysdeps/aarch64/multiarch/strlen_asimd.S) — the Advanced SIMD fast path
4. Then apply the same pattern to memcpy, memset, strcmp

**Practical exercise:**

```bash
# Compare performance yourself
gcc -O2 -march=native test_strlen.c -o test
perf stat ./test

# Verify which implementation is selected at runtime
objdump -d ./test | grep strlen  # follow PLT entry
```

---
id: ch5
title: Chapter 5 — Dynamic Linker and ELF Startup
fileRecommendations:
  readingOrder:
    - path: elf/rtld.c:_dl_start
      description: Runtime loader entry point for dynamic executables
      type: source
    - path: elf/dl-load.c:_dl_map_object
      description: Maps shared objects into the process
      type: source
    - path: elf/dl-reloc.c:_dl_relocate_object
      description: Applies relocations before user code runs
      type: source
    - path: elf/dl-lookup.c:_dl_lookup_symbol_x
      description: Symbol lookup across loaded objects and scopes
      type: source
    - path: sysdeps/aarch64/dl-machine.h
      description: AArch64 relocation and PLT/GOT machine hooks
      type: source
---

The dynamic linker is the first glibc component a dynamically linked program executes. For AArch64, it maps shared libraries, resolves relocations, prepares thread-local storage, and transfers control to the program entry point with the ABI state the application expects.

### Loader Pipeline

The loader pipeline is compact in concept and dense in implementation:

1. `_dl_start` receives control from the kernel's ELF interpreter path.
2. `_dl_map_object` maps the main executable dependencies and their segments.
3. `_dl_lookup_symbol_x` resolves names across loader scopes.
4. `_dl_relocate_object` writes relocated addresses into GOT, data, and TLS slots.
5. The loader calls initialization routines and jumps to the program startup path.

On AArch64, the machine-specific layer handles relocation forms such as `R_AARCH64_RELATIVE`, jump-slot relocation, and TLS descriptors. Keep the generic loader files and the AArch64 machine header open together: the generic code explains when relocation happens; the machine hook explains how each relocation writes process state.

```c
// Mental model for a relocation pass.
for (reloc in object->relocations) {
    symbol = resolve_symbol(reloc);
    value = compute_aarch64_relocation(symbol, reloc.addend);
    write_location(reloc.target, value);
}
```

### PLT, GOT, and Lazy Binding

The Procedure Linkage Table and Global Offset Table let code call symbols whose final address is known only after loading. With lazy binding enabled, the first call to an external function enters the resolver; later calls jump directly through the patched GOT entry.

Use this trace:

```bash
LD_DEBUG=libs,reloc,bindings ./your_program
readelf -a ./your_program | less
objdump -dr ./your_program | less
```

Focus on how `DT_NEEDED` entries become mapped objects, how relocation sections drive writes, and how the AArch64 PLT sequence loads target addresses through the GOT.

---
id: ch6
title: Chapter 6 — Threads, Futexes, and TLS
fileRecommendations:
  readingOrder:
    - path: nptl/pthread_create.c:__pthread_create_2_1
      description: pthread creation path and startup handoff
      type: source
    - path: nptl/pthread_mutex_lock.c:___pthread_mutex_lock
      description: Mutex fast path and futex fallback
      type: source
    - path: nptl/pthread_mutex_unlock.c:___pthread_mutex_unlock
      description: Mutex release and waiter wakeup path
      type: source
    - path: sysdeps/nptl/futex-internal.h
      description: Internal futex operations used by NPTL
      type: source
    - path: sysdeps/aarch64/nptl/tls.h
      description: AArch64 thread pointer and TLS layout hooks
      type: source
---

glibc's Native POSIX Thread Library maps POSIX threads onto Linux tasks. The fast paths stay in user space; the slow paths use futex system calls so the kernel only participates when a thread must block or wake another thread.

### Thread Creation

`pthread_create` allocates a stack, initializes thread descriptors, prepares TLS, and asks the kernel to create a task. The child begins in a glibc start routine, installs its thread pointer, runs user code, and reports termination state for `pthread_join`.

```c
pthread_t thread;
pthread_create(&thread, NULL, worker, arg);
pthread_join(thread, NULL);
```

Trace this with:

```bash
strace -f -e clone,clone3,set_tid_address,futex ./threaded-program
```

The important design point is separation: POSIX semantics live in NPTL, while blocking and wakeup use the Linux futex primitive.

### Mutex Fast Path

A contended mutex is expensive; an uncontended mutex must be cheap. glibc tries an atomic user-space transition first. Only contention enters futex wait or wake.

```c
// Conceptual mutex lock shape.
if (atomic_compare_exchange(&mutex->__data.__lock, 0, locked))
    return 0;

return futex_wait_until_available(mutex);
```

On AArch64, atomics and memory ordering are part of the story. Read the NPTL mutex files with the AArch64 TLS header nearby to connect locks, thread descriptors, cancellation state, and the thread pointer model.

---
id: ch7
title: Chapter 7 — stdio, Buffers, and printf
fileRecommendations:
  readingOrder:
    - path: libio/libio.h
      description: FILE object structures and flags
      type: source
    - path: libio/fileops.c
      description: File-backed stream operations
      type: source
    - path: libio/iofwrite.c:_IO_fwrite
      description: fwrite implementation and buffering path
      type: source
    - path: stdio-common/printf.c:__printf
      description: Public printf wrapper
      type: source
    - path: stdio-common/vfprintf-internal.c:__vfprintf_internal
      description: Core formatted-output engine
      type: source
---

stdio turns small user operations into efficient kernel I/O. The central object is `FILE`: it tracks buffer pointers, flags, file descriptor state, locks, and a table of operations. Most `printf` calls do not enter the kernel directly; they format into a stream buffer, then flush when policy requires it.

### FILE as a State Machine

A stream has read and write regions, error state, EOF state, and buffering mode. The same public API works for terminals, pipes, regular files, memory streams, and custom cookie streams because libio dispatches through operation tables.

```c
printf("value=%d\n", value);
// printf -> __vfprintf_internal -> stream writes -> _IO_file_xsputn -> write syscall when flushed
```

Line buffering, full buffering, and unbuffered mode explain surprising flush behavior:

```c
setvbuf(stdout, NULL, _IONBF, 0);  // unbuffered
setvbuf(stdout, NULL, _IOLBF, 0);  // line buffered
setvbuf(stdout, NULL, _IOFBF, 0);  // fully buffered
```

### printf Parsing

`__vfprintf_internal` is large because it does more than string concatenation. It parses flags, width, precision, length modifiers, locale-sensitive formatting, positional arguments, floating-point conversions, integer bases, padding, and stream locking.

Use this trace order:

1. Start at `stdio-common/printf.c` to see the wrapper.
2. Step into `stdio-common/vfprintf-internal.c` for parsing and formatting.
3. Follow writes into `libio/fileops.c` and then the system-call layer.

```bash
ltrace -e printf,fwrite ./program
strace -e write ./program
```

The difference between those two traces is the point: libc calls are semantic operations; system calls are the final bytes crossing into the kernel.
