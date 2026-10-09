---
curatedRepoId: go-1.27.0
owner: golang
repo: go
revision: go1.27.0
guideId: go-language-guide
name: Go Language In The Mind
description: Understanding Go Before Code
defaultOpenIds:
  - ch1
  - ch2
  - ch3
  - ch4
  - ch5
  - ch6
---

# Go Language In The Mind

## Understanding Go Before Code

> This is not a guide to writing Go programs. This guide explains how Go
> implements the language, toolchain, runtime, and standard library.

The Go repository is a full programming language distribution in one tree. It contains the
compiler, assembler, linker, runtime, standard library, command-line tools, tests, and the scripts
that bootstrap the release.

The important mental model is that Go is not only a syntax and a compiler. The `go` command decides
what package graph to build, `cmd/compile` turns source into object files, `cmd/link` assembles the
program image, and `runtime` supplies goroutines, stacks, allocation, garbage collection, maps,
channels, panic, defer, and low-level OS integration.

---
id: ch1
title: Chapter 1 - Source Tree Mental Model
fileRecommendations:
  readingOrder:
    - path: README.md
      description: Repository overview and canonical source information
      type: docs
    - path: src/README.vendor
      description: Vendoring model for the standard library and cmd modules
      type: docs
    - path: src/make.bash
      description: Unix bootstrap entry point for building Go from source
      type: source
    - path: src/cmd/
      description: Contains toolchain commands, including go, compile, asm, link, vet, and dist.
      type: directory
    - path: src/runtime/
      description: Contains runtime support for execution, scheduling, memory, and OS bindings.
      type: directory
    - path: src/go/
      description: Contains public parser, AST, token, doc, and type-checking packages.
      type: directory
    - path: test/
      description: Contains language, compiler, runtime, and regression tests.
      type: directory
---

### The Repository Is The Distribution

The root of the tree carries project metadata, but the center of gravity is `src/`. Most directories
under `src/` are standard library packages. The exceptions worth learning first are `src/cmd/`, which
contains toolchain commands, and `src/runtime/`, which is linked into every ordinary Go program.

The compiler and runtime are co-designed. The compiler rewrites some language constructs into runtime
calls, emits stack maps for garbage collection, lays out arguments and frames according to the ABI, and
records metadata used by reflection and panic handling. The runtime assumes those compiler contracts
exist.

```chapter-graph
src/cmd/go/main.go -> src/cmd/go/internal/work/build.go : dispatches build commands
src/cmd/go/internal/work/build.go -> src/cmd/compile/internal/gc/main.go : invokes compiler tool
src/cmd/compile/internal/gc/main.go -> src/runtime/proc.go : emits code that depends on runtime contracts
src/make.bash -> src/cmd/dist/build.go : bootstraps toolchain build
```

---
id: ch2
title: Chapter 2 - Compiler Pipeline
fileRecommendations:
  readingOrder:
    - path: src/cmd/compile/README.md
      description: Official map of compiler phases
      type: docs
    - path: src/cmd/compile/internal/gc/main.go
      description: Compiler driver and top-level phase orchestration
      type: source
    - path: src/cmd/compile/internal/syntax/
      description: Contains lexer, parser, and syntax tree.
      type: directory
    - path: src/cmd/compile/internal/types2/
      description: Contains compiler type checker.
      type: directory
    - path: src/cmd/compile/internal/noder/
      description: Contains unified IR, export data, and conversion into compiler IR.
      type: directory
    - path: src/cmd/compile/internal/ir/
      description: Contains compiler IR node definitions.
      type: directory
    - path: src/cmd/compile/internal/ssa/README.md
      description: SSA backend introduction
      type: docs
    - path: src/cmd/compile/internal/ssagen/
      description: Converts compiler IR into SSA.
      type: directory
    - path: src/cmd/internal/obj/
      description: Contains machine code object generation shared by toolchain commands.
      type: directory
---

### The Compiler Is A Sequence Of Representations

Go compilation is easiest to read as a pipeline. Source code becomes syntax trees, syntax trees are
type checked, type-checked packages are converted into compiler IR, IR is simplified and optimized,
SSA is generated, and architecture-specific lowering produces object code.

The official compiler README is the best high-level map. It identifies parsing in
`src/cmd/compile/internal/syntax`, type checking in `src/cmd/compile/internal/types2`, IR construction
in `src/cmd/compile/internal/noder`, middle-end passes such as inlining and escape analysis, walk,
SSA, and final machine-code generation.

```chapter-graph
src/cmd/compile/internal/syntax/parser.go -> src/cmd/compile/internal/types2/check.go : parsed files are type checked
src/cmd/compile/internal/types2/check.go -> src/cmd/compile/internal/noder/writer.go : checked packages become unified IR
src/cmd/compile/internal/noder/reader.go -> src/cmd/compile/internal/ir/expr.go : unified data becomes compiler IR
src/cmd/compile/internal/ssagen/ssa.go -> src/cmd/compile/internal/ssa/compile.go : IR becomes SSA functions
src/cmd/compile/internal/ssa/compile.go -> src/cmd/internal/obj/plist.go : lowered instructions become object program data
```

### Read The Driver Last, Not First

[src/cmd/compile/internal/gc/main.go](src/cmd/compile/internal/gc/main.go) imports much of the
compiler because it coordinates the whole process. Read that entry point once you know the phase names.
Without that context, the flags, setup, and pass ordering obscure the phase boundaries.

Use the compiler README to anchor the flow, then inspect one phase at a time. A productive first pass
is syntax, types2, noder, escape, inline, walk, ssagen, and ssa.

---
id: ch3
title: Chapter 3 - Runtime Scheduler And Goroutines
fileRecommendations:
  readingOrder:
    - path: src/runtime/runtime2.go
      description: Core runtime structs, including g, m, p, schedt, and sudog
      type: source
    - path: src/runtime/proc.go
      description: Goroutine scheduler, startup, and execution management
      type: source
    - path: src/runtime/stack.go
      description: Goroutine stack growth, copying, and stack metadata
      type: source
    - path: src/runtime/chan.go
      description: Channel implementation and blocking protocol
      type: source
    - path: src/runtime/select.go
      description: Select implementation over channel operations
      type: source
    - path: src/runtime/time.go
      description: Runtime timers used by scheduling and time operations
      type: source
---

### G, M, And P Are The Scheduler Vocabulary

The Go scheduler is built around three entities. A `g` is a goroutine, an `m` is an operating-system
thread, and a `p` is the processor token that owns scheduler resources needed to run Go code. You
will see this vocabulary across `runtime`.

[src/runtime/runtime2.go](src/runtime/runtime2.go) defines the core structs. [src/runtime/proc.go](src/runtime/proc.go)
then shows how goroutines are created, parked, made runnable, stolen, stopped for garbage collection,
and resumed.

```chapter-graph
src/runtime/runtime2.go -> src/runtime/proc.go : defines scheduler state used by scheduling code
src/runtime/proc.go -> src/runtime/stack.go : scheduling depends on movable goroutine stacks
src/runtime/chan.go -> src/runtime/proc.go : channel blocking parks and wakes goroutines
src/runtime/select.go -> src/runtime/chan.go : select coordinates multiple channel operations
```

### Blocking Is A Runtime Operation

A goroutine blocked on a channel, timer, network poller, mutex, or system call is more than a sleeping
function. Runtime code records why the goroutine waits, detaches or reuses scheduler resources, and arranges
for another goroutine to run. That is why scheduler code touches apparently separate systems like
channels, timers, cgo, and the garbage collector.

---
id: ch4
title: Chapter 4 - Garbage Collection And Memory
fileRecommendations:
  readingOrder:
    - path: src/runtime/mgc.go
      description: Garbage collector overview and cycle control
      type: source
    - path: src/runtime/mgcsweep.go
      description: Sweeping and span reclamation
      type: source
    - path: src/runtime/mgcmark.go
      description: Mark phase mechanics
      type: source
    - path: src/runtime/malloc.go
      description: Allocation fast paths and heap allocation entry points
      type: source
    - path: src/runtime/mheap.go
      description: Heap arena and span management
      type: source
    - path: src/runtime/mspanset.go
      description: Span set structures used by allocator and GC work
      type: source
    - path: src/runtime/mbitmap.go
      description: Heap pointer bitmap metadata used by the collector
      type: source
---

### Allocation, Metadata, And Collection Are One System

The memory manager is split across allocator, heap, span, bitmap, mark, and sweep files, but those
pieces form one contract. Allocation needs metadata for object size and pointer layout. The garbage
collector needs stack maps and heap bitmaps to find pointers. Sweeping returns unused spans to the
allocator.

```chapter-graph
src/runtime/malloc.go -> src/runtime/mheap.go : requests spans from the heap
src/runtime/mheap.go -> src/runtime/mspanset.go : manages span collections
src/runtime/mgc.go -> src/runtime/mgcmark.go : starts and controls marking
src/runtime/mgcmark.go -> src/runtime/mbitmap.go : uses pointer metadata to scan objects
src/runtime/mgcsweep.go -> src/runtime/mheap.go : returns swept spans to heap structures
```

### The Compiler Feeds The Collector

The runtime collector can only be precise because the compiler emits pointer information for stacks,
globals, and types. When you read GC code, keep one eye on compiler phases that compute liveness and
emit metadata. This is one of the strongest examples of Go's compiler-runtime contract.

---
id: ch5
title: Chapter 5 - Go Command And Builds
fileRecommendations:
  readingOrder:
    - path: src/cmd/go/main.go
      description: go command entry point
      type: source
    - path: src/cmd/go/internal/base/
      description: Contains shared command registration and invocation support.
      type: directory
    - path: src/cmd/go/internal/work/build.go
      description: go build command and build flag behavior
      type: source
    - path: src/cmd/go/internal/load/
      description: Contains package loading and import graph construction.
      type: directory
    - path: src/cmd/go/internal/modload/init.go
      description: Module-mode initialization and module root discovery
      type: source
    - path: src/cmd/go/internal/modfetch/
      description: Contains module download and proxy/cache behavior.
      type: directory
    - path: src/cmd/go/internal/cache/
      description: Contains build cache support.
      type: directory
---

### The Go Command Is The Build System Front Door

Most users do not invoke `compile` directly. They invoke `go build`, `go test`, `go run`, `go list`,
or `go mod`, and the `go` command decides package loading, module mode, cache keys, environment,
tool invocations, and output behavior.

```chapter-graph
src/cmd/go/main.go -> src/cmd/go/internal/base/base.go : registers and invokes commands
src/cmd/go/internal/work/build.go -> src/cmd/go/internal/load/pkg.go : build needs package graphs
src/cmd/go/internal/load/pkg.go -> src/cmd/go/internal/modload/init.go : module mode affects package resolution
src/cmd/go/internal/work/build.go -> src/cmd/go/internal/cache/cache.go : action outputs are cached
```

### Build Behavior Lives Outside The Compiler

Compiler internals explain how a package becomes object code. They do not explain why a package was
selected, whether a module download happened, which files matched build tags, or why the build cache
was reused. Start tracing those questions under `src/cmd/go/internal/`.

---
id: ch6
title: Chapter 6 - Standard Library And Analysis Packages
fileRecommendations:
  readingOrder:
    - path: src/go/parser/
      description: Contains public parser used by tools.
      type: directory
    - path: src/go/ast/
      description: Contains public syntax tree representation.
      type: directory
    - path: src/go/types/
      description: Contains public type checker used by analysis tools.
      type: directory
    - path: src/fmt/
      description: Contains formatting package with reflection-heavy value printing.
      type: directory
    - path: src/net/http/
      description: Contains HTTP client and server implementation.
      type: directory
    - path: src/sync/
      description: Contains synchronization primitives and runtime-linked behavior.
      type: directory
    - path: src/internal/
      description: Contains shared implementation packages hidden from external imports.
      type: directory
---

### The Standard Library Is Both API And Implementation

The library directories under `src/` are ordinary packages from the user's point of view. Internally, they
are also examples of how the Go project organizes portable APIs, platform-specific files, internal
helpers, tests, and runtime hooks.

The `src/go/` packages matter because they are public tooling APIs, not the compiler
front end used by `cmd/compile`. The compiler has its own syntax and type-checking packages, while
tools such as formatters, linters, documentation generators, and editors often use
[src/go/parser](src/go/parser/), [src/go/ast](src/go/ast/), and [src/go/types](src/go/types/).

```chapter-graph
src/go/parser/parser.go -> src/go/ast/ast.go : parser produces public AST nodes
src/go/types/check.go -> src/go/ast/ast.go : public type checker reads ASTs
src/fmt/print.go -> src/reflect/value.go : formatting inspects dynamic values
src/sync/mutex.go -> src/runtime/sema.go : sync primitives rely on runtime semaphores
src/net/http/server.go -> src/net/http/transport.go : server and client share protocol infrastructure
```

### Read Packages Through Their Tests

For standard library packages, tests are often the quickest way to learn intended behavior. Open the
package directory, read the main implementation file, then inspect nearby test files for edge cases
and compatibility expectations. For packages with platform-specific behavior, compare Unix, Linux,
Windows, amd64, and arm64 suffixed files.
