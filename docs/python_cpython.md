---
curatedRepoId: python-cpython-3.14.0
owner: python
repo: cpython
revision: v3.14.0
guideId: cpython-guide
name: CPython In The Mind
description: Understanding CPython Before Code
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
  - ch11
  - ch12
  - ch13
---

# CPython In The Mind

## Understanding CPython Before Code

> This isn't a guide to writing Python code. It's an effort to understand how CPython thinks.

CPython is the reference implementation of Python, written in C. It compiles Python source code to bytecode and executes it on a virtual machine. Understanding CPython's internals reveals how Python's elegant syntax translates into efficient execution, how objects are managed in memory, and how the interpreter orchestrates program execution.

This guide targets CPython 3.14.0. Its cross-project traces use glibc 2.39 and Linux 6.1 as source-reading baselines, with AArch64 examples for architecture-specific boundaries. These independent pins are not a tested distribution or ABI configuration. Verify the actual interpreter build, linked C library, architecture, and running kernel before comparing a live trace. Linux CPython builds can use another libc, and embedding or static linking can change startup and loading paths.

Version-specific details matter: bytecode cases are generated from `Python/bytecodes.c`, selected instructions specialize at runtime, and the source includes both default-GIL and free-threaded build paths.

This guide is for anyone who wants to build a mental model of how CPython works—before diving deep into the source code. Whether you're exploring Python internals for the first time or returning with new questions, the focus here is on **behavior, not syntax**.

**CPython runs Python. Let's understand how it runs.**

---
id: ch1
title: Chapter 1 — Understanding CPython Before Code
fileRecommendations:
  readingOrder:
    - path: Doc/c-api/
      description: Python C API reference
      type: directory
    - path: Doc/extending/
      description: Extending Python with C
      type: directory
    - path: Doc/glossary.rst
      description: GIL and core term definitions
      type: docs
    - path: Doc/c-api/memory.rst
      description: Memory management overview
      type: docs
    - path: Python/ceval.c:_PyEval_EvalFrameDefault
      description: Main evaluation loop — the heart of CPython
      type: source
    - path: Include/object.h:PyObject_HEAD
      description: PyObject struct — foundation of all Python objects
      type: source
    - path: Python/bytecodes.c
      description: Instruction definitions that generate the interpreter cases
      type: source
    - path: Python/gc.c
      description: Default-build incremental cyclic garbage collector
      type: source
    - path: Python/gc_free_threading.c:gc_collect_main
      description: Free-threaded cyclic garbage collector
      type: source
---


### CPython Compiles and Interprets Code

CPython is both a compiler and an interpreter. It compiles Python source code to bytecode, then executes that bytecode on a stack-based virtual machine. Understanding this dual nature reveals how Python achieves its balance between high-level expressiveness and runtime efficiency. The compilation phase handles syntax analysis and optimization, while the interpreter handles execution, memory management, and dynamic behavior.

### Everything Is an Object: The Foundation of Python

In Python, everything is an object—integers, functions, classes, modules, even types themselves. This uniform object model simplifies the language design and enables powerful features like introspection, dynamic typing, and metaprogramming. Understanding this principle reveals how CPython manages memory, implements polymorphism, and provides a consistent interface across all language constructs.

[Include/object.h](Include/object.h) defines `PyObject`, and [Objects/typeobject.c](Objects/typeobject.c) implements the type system.

### The Global Interpreter Lock (GIL): Concurrency in CPython

In the default CPython build, the Global Interpreter Lock (GIL) protects access to Python objects and serializes bytecode execution by native threads sharing that GIL. Subinterpreters configured with their own GIL can execute in parallel. CPython 3.14 also supports optional free-threaded builds guarded by `Py_GIL_DISABLED`, so read GIL-related code with the build mode in mind. On Linux with glibc, compare [`pthread_create`](repo:bminor/glibc/nptl/pthread_create.c:pthread_create) with Linux's [`kernel_clone`](repo:torvalds/linux/kernel/fork.c:kernel_clone): a Python thread depends on both the POSIX user-space API and a kernel task.

See [Doc/c-api/init.rst](Doc/c-api/init.rst) for interpreter initialization and the GIL lifecycle.

### Memory Management: Reference Counting and Garbage Collection

CPython uses a combination of reference counting and a cyclic garbage collector for memory management. Most objects are deallocated when their reference count reaches zero, while selected constants and runtime singletons can be immortal. Free-threaded builds use biased reference counting with local and shared counts, plus deferred reference counting for selected objects whose reclamation requires GC. Reference counting alone cannot handle circular references, so CPython includes a garbage collector that detects and collects cycles.

See [Doc/c-api/gcsupport.rst](Doc/c-api/gcsupport.rst) for garbage collector support documentation.

---
id: ch2
title: Chapter 2 — Source Code Structure
fileRecommendations:
  readingOrder:
    - path: Doc/
      description: Official Python documentation source
      type: directory
    - path: Doc/c-api/veryhigh.rst#the-very-high-level-layer
      description: High-level compilation API
      type: docs
    - path: Python/ceval.c:_PyEval_EvalFrameDefault
      description: Main evaluation loop and frame execution entry point
      type: source
    - path: Python/bytecodes.c
      description: Source definitions for generated bytecode cases
      type: source
    - path: Python/generated_cases.c.h
      description: Generated interpreter instruction cases included by ceval.c
      type: source
    - path: Python/compile.c
      description: Bytecode compiler — AST to bytecode
      type: source
    - path: Objects/typeobject.c:type_new
      description: Type construction, slots, and method resolution
      type: source
    - path: Include/object.h:PyObject_HEAD
      description: Common object header and type-related public API
      type: source
    - path: Parser/lexer/lexer.c
      description: Lexical analysis — source to tokens
      type: source
    - path: Grammar/python.gram
      description: PEG grammar used to generate the parser
      type: source
---


```chapter-graph
Parser/lexer/lexer.c -> Parser/parser.c : tokens → AST
Grammar/python.gram -> Parser/parser.c : pegen generates parser
Parser/parser.c -> Python/compile.c : parser constructs AST for compilation
Python/compile.c -> Python/symtable.c : builds the symbol table
Python/compile.c -> Python/codegen.c : delegates AST instruction generation
Python/compile.c -> Python/flowgraph.c : orchestrates control-flow optimization
Python/compile.c -> Python/assemble.c : assembles the code object
Python/bytecodes.c -> Python/generated_cases.c.h : generate instruction cases
Python/generated_cases.c.h -> Python/ceval.c : bytecode execution cases
Python/frame.c -> Python/ceval.c : execution context
```

### The Compilation Pipeline: From Source to Bytecode

CPython's compilation process transforms Python source code into bytecode through tokenization, PEG parsing, AST construction, and bytecode generation. In 3.14, the parser is generated from `Grammar/python.gram`, and the interpreter instruction cases are generated from `Python/bytecodes.c`. [The compiler entry](Python/compile.c:_PyAST_Compile) orchestrates [symbol analysis](Python/symtable.c:_PySymtable_Build), [instruction generation](Python/codegen.c), [control-flow optimization](Python/flowgraph.c), and [code-object assembly](Python/assemble.c:_PyAssemble_MakeCodeObject). These are separate implementation stages rather than one monolithic bytecode generator.

### The Execution Model: Bytecode to Results

CPython executes bytecode using a stack-based interpreter. The main frame executor lives in [Python/ceval.c](Python/ceval.c), while instruction bodies are defined in [Python/bytecodes.c](Python/bytecodes.c) and generated into [Python/generated_cases.c.h](Python/generated_cases.c.h). The interpreter manipulates stack references, maintains frames, and specializes hot operations. Tier-two execution and the experimental JIT depend on build options and runtime configuration; they are not the default execution path in every build.

See [Include/opcode_ids.h](Include/opcode_ids.h) for generated opcode IDs, [Include/internal/pycore_opcode_metadata.h](Include/internal/pycore_opcode_metadata.h) for generated metadata, and [Python/frame.c](Python/frame.c) for frame management.

---
id: ch3
title: Chapter 3 — The Object Model
fileRecommendations:
  readingOrder:
    - path: Doc/c-api/object.rst#object-protocol
      description: Object protocol
      type: docs
    - path: Doc/c-api/typeobj.rst
      description: Type objects reference
      type: docs
    - path: Doc/c-api/refcounting.rst
      description: Reference counting API
      type: docs
    - path: Doc/c-api/gcsupport.rst
      description: Garbage collector support
      type: docs
    - path: Include/object.h:PyObject_HEAD
      description: Common object header and type-related public API
      type: source
    - path: Objects/object.c
      description: Base object implementation
      type: source
    - path: Objects/typeobject.c:type_new
      description: Type construction, slots, and method resolution
      type: source
    - path: Python/gc.c
      description: Default-build incremental cyclic garbage collector
      type: source
    - path: Python/gc_free_threading.c:gc_collect_main
      description: Free-threaded cyclic garbage collector
      type: source
    - path: Objects/abstract.c
      description: Abstract object protocol dispatch
      type: source
---


```chapter-graph
Include/object.h -> Objects/object.c : PyObject struct → impl
Objects/object.c -> Objects/typeobject.c : base ops → type slots
Include/cpython/object.h -> Include/object.h : internal details extend public API
Objects/abstract.c -> Objects/typeobject.c : protocol dispatch via type slots
Objects/object.c -> Include/cpython/object.h : ob_type → PyTypeObject
Python/gc.c -> Include/internal/pycore_gc.h : default-build GC state
Python/gc_free_threading.c -> Include/internal/pycore_gc.h : free-threaded GC state
```

### PyObject: The Base of Everything

All Python objects in CPython are represented by structures that begin with `PyObject` (or `PyObject_HEAD`). This common header contains the object's type pointer and reference count. This design enables polymorphism: any function that accepts a `PyObject*` can work with any Python object, and the type system determines the correct behavior at runtime.

### Type Objects: Defining Behavior

In Python, types are themselves objects. The `PyTypeObject` structure defines how objects of a particular type behave: what methods they support, how they're created, how they're compared, and how they're represented as strings. Understanding type objects reveals how Python's dynamic typing and method resolution work.

See [Doc/c-api/typeobj.rst](Doc/c-api/typeobj.rst) for the full type object slot reference.

### Reference Counting: Automatic Memory Management

CPython uses reference counting as its primary memory management mechanism. Ordinary reference-counted objects are deallocated when their count reaches zero. CPython 3.14 also uses immortal objects for selected constants. Free-threaded builds use biased reference counting, which separates local and shared counts, and deferred reference counting, which leaves some references uncounted until GC determines whether an object is reclaimable. The memory below CPython's object layer is a useful cross-reference: glibc's [`__libc_malloc`](repo:bminor/glibc/malloc/malloc.c:__libc_malloc) manages user-space heap storage, while Linux's [`do_mmap`](repo:torvalds/linux/mm/mmap.c:do_mmap) creates virtual-memory areas. This is a set of related ownership layers, not a universal object-to-malloc-to-mmap call chain. In the default build, pymalloc serves small allocations from pools and can get arenas with mmap; larger requests can use the raw allocator. Free-threaded object allocation requires mimalloc. Chapter 11 traces these branches and distinguishes object destruction from releasing virtual memory.

Read the reference-count operations in [Include/object.h](Include/object.h) beside [deallocation support](Objects/object.c). The full type-object layout is in [Include/cpython/object.h](Include/cpython/object.h), while the public object header provides type pointers and APIs.

### Garbage Collection: Handling Cycles

While reference counting handles most memory management, it cannot detect or break circular references. CPython includes a cyclic garbage collector that periodically scans for unreachable cycles and collects them. Understanding the garbage collector reveals how CPython handles complex object graphs and why some objects may survive until a later collection.

In the default build of **3.14.0**, [Python/gc.c](Python/gc.c) implements incremental collection, spreading old-generation work across collections. The free-threaded build uses a separate collector in [Python/gc_free_threading.c](Python/gc_free_threading.c), with stop-the-world coordination and support for deferred reference counting. [Modules/gcmodule.c](Modules/gcmodule.c) exposes the Python-level `gc` module. These details are pinned to 3.14.0; later maintenance releases can change collector behavior.

---
id: ch4
title: Chapter 4 — Built-in Types
fileRecommendations:
  readingOrder:
    - path: Doc/c-api/long.rst
      description: Integer objects C API
      type: docs
    - path: Doc/c-api/unicode.rst
      description: Unicode string objects
      type: docs
    - path: Doc/c-api/list.rst
      description: List objects
      type: docs
    - path: Doc/c-api/dict.rst
      description: Dictionary objects
      type: docs
    - path: Objects/longobject.c:long_add
      description: Integer implementation — arbitrary precision
      type: source
    - path: Objects/unicodeobject.c:PyUnicode_New
      description: Unicode allocation, representation, and operations
      type: source
    - path: Objects/listobject.c:list_resize
      description: List — dynamic array implementation
      type: source
    - path: Objects/dictobject.c:PyDict_SetItem
      description: Dictionary — hash table implementation
      type: source
    - path: Objects/setobject.c
      description: Set implementation
      type: source
---


```chapter-graph
Include/object.h -> Objects/longobject.c : PyObject head + digit array
Include/object.h -> Objects/unicodeobject.c : PyObject head + kind/state
Include/object.h -> Objects/listobject.c : PyObject head + ob_item[]
Include/object.h -> Objects/dictobject.c : PyObject head + hash table
Include/object.h -> Objects/setobject.c : PyObject head + hash table
Objects/longobject.c -> Objects/dictobject.c : int keys require hash
Objects/unicodeobject.c -> Objects/dictobject.c : string hashing and equality for keys
```

### Integers: Arbitrary Precision

Python integers have arbitrary precision, meaning they can represent numbers of any size limited only by available memory. CPython implements this using a variable-length representation that allocates more memory as numbers grow larger. Understanding integer implementation reveals how Python achieves both performance for small numbers and correctness for large ones.

### Strings: Unicode and Immutability

Python strings are immutable sequences of Unicode code points. In 3.14, [the Unicode structures](Include/cpython/unicodeobject.h) distinguish compact ASCII, compact non-ASCII, and non-compact layouts, with one-, two-, or four-byte code-unit kinds as appropriate. Compactness and character width describe different properties. The old wchar-based legacy representation was removed in 3.12; this snapshot uses the newer layouts. UTF-8 caches, interning, and the canonical character data also have separate roles.

### Lists: Dynamic Arrays

Python lists are implemented as dynamic arrays (like C++'s `std::vector`). They maintain a contiguous block of pointers to objects, automatically resizing when capacity is exceeded. Understanding list implementation reveals how Python achieves O(1) indexing while supporting dynamic growth.

### Dictionaries: Hash Tables

Python dictionaries are implemented as hash tables with open addressing. They use a clever probing strategy and maintain insertion order (as of Python 3.7). Understanding dictionary implementation reveals how Python achieves average O(1) lookups while maintaining predictable iteration order.

---
id: ch5
title: Chapter 5 — The Evaluation Loop
fileRecommendations:
  readingOrder:
    - path: Doc/library/dis.rst#python-bytecode-instructions
      description: Bytecode disassembler module documentation
      type: docs
    - path: Doc/c-api/init.rst
      description: Interpreter state and frame objects
      type: docs
    - path: Python/ceval.c:_PyEval_EvalFrameDefault
      description: Main evaluation loop — the heart of CPython
      type: source
    - path: Python/bytecodes.c
      description: Instruction definitions for generated cases
      type: source
    - path: Python/generated_cases.c.h
      description: Generated interpreter cases included by ceval.c
      type: source
    - path: Include/opcode_ids.h
      description: Generated bytecode opcode IDs
      type: source
    - path: Include/internal/pycore_stackref.h
      description: Internal stack-reference representation used by the VM
      type: source
    - path: Python/frame.c
      description: Execution frame management
      type: source
    - path: Include/internal/pycore_interpframe_structs.h
      description: Internal execution frame structure
      type: source
    - path: Include/internal/pycore_frame.h
      description: Python-visible frame object structure
      type: source
    - path: Lib/dis.py:dis
      description: Python bytecode disassembler
      type: source
---


```chapter-graph
Python/bytecodes.c -> Python/generated_cases.c.h : instruction definitions generate cases
Python/generated_cases.c.h -> Python/ceval.c : included by the frame executor
Python/codegen.c -> Include/opcode_ids.h : instruction generation uses opcode IDs
Python/ceval.c -> Python/frame.c : uses execution-frame helpers and visible-frame materialization
Include/internal/pycore_interpframe_structs.h -> Python/frame.c : internal execution frame definition
Include/internal/pycore_frame.h -> Python/frame.c : Python-visible frame object definition
Python/frame.c -> Include/internal/pycore_interpframe.h : gets the code through frame helpers
Include/cpython/code.h -> Include/internal/pycore_interpframe_structs.h : code objects describe executable frame contents
Lib/opcode.py -> Lib/dis.py : supplies opcode names and metadata
```

### The Main Loop: ceval.c

The heart of CPython is the frame executor in [Python/ceval.c](Python/ceval.c), centered on `_PyEval_EvalFrameDefault`. In 3.14, most instruction behavior is written in [Python/bytecodes.c](Python/bytecodes.c) and generated into [Python/generated_cases.c.h](Python/generated_cases.c.h). The loop manipulates stack references, checks eval-breaker events, and specializes hot instructions. Builds can also enable tier-two executor paths or the experimental JIT. The optional tail-call interpreter changes C-level instruction dispatch, not Python's function-call semantics.

### Frames: Execution Context

Each Python function invocation has an internal execution frame containing local variables, the value stack, and execution state. Active frames are linked together to form a call stack. A Python-visible `PyFrameObject` is materialized when needed for introspection or tracebacks, rather than allocated for every call. Generators and coroutines keep internal frames across suspension and resumption.

### Bytecode Instructions: The Language of the VM

CPython bytecode consists of instructions that operate on a value stack. Instructions like `RESUME`, `LOAD_FAST`, `LOAD_CONST`, `BINARY_OP`, `CALL`, `CALL_KW`, `RETURN_VALUE`, and `YIELD_VALUE` form the building blocks of Python execution. Hot generic instructions can specialize into forms such as `BINARY_OP_ADD_INT`, `CALL_PY_EXACT_ARGS`, or `LOAD_ATTR_INSTANCE_VALUE`.

Use [Lib/dis.py](Lib/dis.py) to disassemble any Python function and see the bytecode directly:

```python
import dis
dis.dis(lambda x: x * 2 + 1)
```

---
id: ch6
title: Chapter 6 — Import System and Modules
fileRecommendations:
  readingOrder:
    - path: Doc/c-api/import.rst
      description: Import system C API
      type: docs
    - path: Doc/library/importlib.rst
      description: importlib — the import machinery
      type: docs
    - path: Doc/c-api/module.rst
      description: Module objects
      type: docs
    - path: Python/import.c:PyImport_ImportModule
      description: Import system implementation
      type: source
    - path: Objects/moduleobject.c
      description: Module object implementation
      type: source
    - path: Lib/importlib/
      description: Import library Python implementation
      type: directory
---


```chapter-graph
Python/import.c -> Objects/moduleobject.c : creates module objects
Objects/moduleobject.c -> Include/moduleobject.h : module struct + API
Python/bytecodes.c -> Python/ceval.c : IMPORT_NAME calls the evaluation import helper
Python/ceval.c -> Python/import.c : default import fast path invokes PyImport_ImportModuleLevelObject
Python/import.c -> Lib/importlib/_bootstrap.py : uses importlib bootstrap machinery
```

### The Import System: Loading Code Dynamically

Python's import system finds, loads, and initializes modules. It searches through a list of paths (sys.path), caches loaded modules, and handles both built-in modules (written in C) and Python modules. Understanding the import system reveals how Python organizes code and enables dynamic program structure.

Importing a dynamically loaded C extension also crosses into the platform loader. On relevant Unix platforms, [Python/dynload_shlib.c](Python/dynload_shlib.c) calls `dlopen()` and looks up the extension's initialization function. This happens inside the running Python process, rather than restarting executable loading. Pure Python imports travel through bytecode such as `IMPORT_NAME` and the `importlib` bootstrap code.

### Module Objects: Namespaces as Objects

In Python, modules are objects that serve as namespaces for code organization. Module objects contain a dictionary of their attributes and maintain metadata about their location and loading. Understanding module objects reveals how Python's namespace system works and how code is organized and accessed.

---
id: ch7
title: Chapter 7 — Exception Handling
fileRecommendations:
  readingOrder:
    - path: Doc/c-api/exceptions.rst
      description: Exception handling and traceback objects
      type: docs
    - path: Python/errors.c:PyErr_SetString
      description: Exception raising and handling machinery
      type: source
    - path: Objects/exceptions.c:BaseException_new
      description: Built-in exception type hierarchy
      type: source
    - path: Python/traceback.c:PyTraceBack_Here
      description: Traceback object construction
      type: source
    - path: Include/pyerrors.h
      description: Exception type declarations
      type: source
---


```chapter-graph
Include/pyerrors.h -> Python/errors.c : exception type declarations → impl
Python/errors.c -> Objects/exceptions.c : raises built-in exception objects
Objects/exceptions.c -> Include/pyerrors.h : concrete exception hierarchy
Python/bytecodes.c -> Python/ceval.c : RAISE_VARARGS invokes do_raise
Python/ceval.c -> Python/errors.c : sets or restores the raised exception state
Python/bytecodes.c -> Python/traceback.c : interpreter unwind path records traceback frames
Python/traceback.c -> Include/cpython/traceback.h : traceback object layout
```

### Exceptions: Error Propagation

Python's exception system provides a structured way to handle errors and propagate them through the call stack. Exceptions are objects that can be raised, caught, and inspected. CPython implements exceptions using a combination of bytecode instructions and C-level error flag checking for efficient propagation.

### Tracebacks: Understanding Errors

[RAISE_VARARGS](Python/bytecodes.c:RAISE_VARARGS) calls [do_raise](Python/ceval.c:do_raise). Raising an exception value and re-raising the active exception take different paths; the latter can restore raised-exception state directly. The interpreter's error path records traceback frames as needed before its [exception_unwind path](Python/bytecodes.c:exception_unwind) consults handler information. A traceback is a chain of participating frames, not an eager copy of the entire call stack made by every public error setter. Follow [traceback construction](Python/traceback.c:PyTraceBack_Here) alongside [the traceback layout](Include/cpython/traceback.h).

---
id: ch8
title: Chapter 8 — Advanced Topics
fileRecommendations:
  readingOrder:
    - path: Doc/c-api/gen.rst
      description: Generator objects C API
      type: docs
    - path: Doc/c-api/descriptor.rst
      description: Descriptor protocol
      type: docs
    - path: Doc/c-api/
      description: Complete C API reference
      type: directory
    - path: Doc/extending/
      description: Extending Python with C
      type: directory
    - path: Objects/genobject.c:gen_send_ex
      description: Generator and coroutine implementation
      type: source
    - path: Include/internal/pycore_interpframe.h
      description: Internal interpreter frame helpers
      type: source
    - path: Include/cpython/genobject.h
      description: Generator object definitions
      type: source
    - path: Objects/descrobject.c:PyDescr_NewMethod
      description: Descriptor protocol implementation
      type: source
    - path: Include/Python.h
      description: Master C API header
      type: source
---


```chapter-graph
Include/cpython/genobject.h -> Objects/genobject.c : generator struct → impl
Objects/genobject.c -> Python/ceval.c : resumes suspended frame through _PyEval_EvalFrame
Objects/genobject.c -> Include/internal/pycore_interpframe.h : stores interpreter frames in generators
Include/descrobject.h -> Objects/descrobject.c : descriptor protocol → impl
Objects/descrobject.c -> Objects/typeobject.c : __get__/__set__ registered as type slots
Include/Python.h -> Include/object.h : master header pulls in PyObject for C API users
Include/Python.h -> Include/pyerrors.h : C API exposes exception types
```

### Descriptors: The Magic Behind Properties

Python's descriptor protocol enables powerful features like properties, class methods, and static methods. Descriptors are objects that define how attribute access works for a class. Understanding descriptors reveals how Python's object-oriented features are implemented and how custom attribute-access behavior works.

### Generators and Coroutines: Pausable Execution

Python generators and coroutines enable pausable execution through the use of special frame objects that can be suspended and resumed. Understanding how generators work reveals how Python implements iteration, async/await, and other advanced control flow features.

### The C API: Extending Python

CPython provides a comprehensive C API for extending Python with C code or embedding Python in C applications. Understanding the C API reveals how Python's features are implemented and how high-performance extensions connect to the runtime.

See [Doc/extending/](Doc/extending/) for the complete guide to extending Python with C.

---
id: ch9
title: Chapter 9 — GIL and Free-Threading in Python 3.14
fileRecommendations:
  readingOrder:
    - path: Doc/howto/free-threading-python.rst
      description: User-facing free-threaded Python guide
      type: docs
    - path: Doc/howto/free-threading-extensions.rst
      description: C extension guidance for free-threaded builds
      type: docs
    - path: Doc/c-api/init.rst
      description: Thread state, GIL, and initialization APIs
      type: docs
    - path: Python/ceval_gil.c
      description: GIL implementation, switch interval, and free-threaded toggles
      type: source
    - path: Include/internal/pycore_gil.h
      description: Internal GIL runtime state
      type: source
    - path: Python/pystate.c
      description: Thread state attach and detach machinery
      type: source
    - path: Include/object.h
      description: Object header and reference-count fields
      type: source
    - path: Include/internal/pycore_object.h
      description: Internal object and reference-count helpers
      type: source
---

Python 3.14 has two relevant execution modes. The default CPython build still runs with the Global Interpreter Lock enabled. The free-threaded build is an optional, officially supported build where Python threads can execute Python bytecode in parallel when the GIL is disabled at runtime.

This distinction matters when reading source. A lock, refcount operation, object access, or extension API can behave differently depending on whether the build defines `Py_GIL_DISABLED` and whether the runtime has the GIL enabled.

### Default Build: One Bytecode Executor at a Time

In the default build, the GIL protects Python object internals and serializes bytecode execution across native threads sharing that GIL. Threads still overlap during I/O or C code that releases the GIL. Subinterpreters configured with `PyInterpreterConfig_OWN_GIL` have separate locks and can execute bytecode in parallel; the restriction is not necessarily process-wide.

`Python/ceval_gil.c` is the center of this model. It stores the GIL state, implements the switch interval, handles drop requests, and attaches or detaches thread states around blocking regions.

```c
// Conceptual default-build shape.
take_gil(tstate);
_PyEval_EvalFrameDefault(tstate, frame, throwflag);
drop_gil(interp, tstate, 0);
```

The actual interpreter uses more detailed control flow, but this shape captures the invariant: a thread must own the runtime's execution permission before it mutates ordinary Python runtime state.

### Free-Threaded Build: GIL Optional, Synchronization Localized

The free-threaded build is selected with the `--disable-gil` configure option. It defaults to running without the GIL but retains support for enabling it at runtime. In that build, `Py_GIL_DISABLED` activates alternate paths across the runtime. CPython uses biased reference counting with local and shared counts, deferred reference counting for selected objects, object-level synchronization, critical sections, and stop-the-world coordination for runtime-wide events.

Use these runtime checks when experimenting:

```python
import sys
import sysconfig

print(sys.version)
print(sysconfig.get_config_var("Py_GIL_DISABLED"))
print(sys._is_gil_enabled())
```

The build can support free threading while the process still has the GIL enabled. Python 3.14 exposes runtime controls through `PYTHON_GIL` and `-X gil`. When the GIL is disabled by default, importing a C extension that has not declared free-threading support enables it with a warning. Explicitly forcing it off with `PYTHON_GIL=0` or `-X gil=0` prevents that fallback; it does not make the extension thread-safe.

### Thread State Still Matters

Free-threaded does not mean unmanaged. A native thread must still attach to the interpreter before it calls Python C API functions. Existing APIs such as `PyGILState_Ensure`, `PyGILState_Release`, `PyEval_SaveThread`, and `PyEval_RestoreThread` remain relevant because they manage thread state attachment even when no global lock is active.

```c
PyGILState_STATE state = PyGILState_Ensure();
/* Attached to the main interpreter; shared state still needs synchronization. */
PyGILState_Release(state);
```

`PyGILState_*` assumes the main interpreter and is not suitable for attaching a native thread to a subinterpreter. Use the `PyThreadState_*` APIs with the intended interpreter for that case. An attached thread state permits C API access, but does not replace locks around extension-owned shared state in a free-threaded build.

Read `Python/pystate.c` beside `Python/ceval_gil.c`: the first file explains which thread state is current, while the second explains whether that attached thread must also own the GIL.

### C Extensions: Declare Safety or Re-Enable the GIL

C extensions are the compatibility boundary. An extension built around old assumptions may rely on the GIL to protect borrowed references, global caches, or direct struct-field access. Python 3.14 asks extensions to declare free-threading support. Without that declaration, importing the extension enables the GIL unless the user explicitly forced it off.

Multi-phase modules declare support with a module slot:

```c
static struct PyModuleDef_Slot module_slots[] = {
    {Py_mod_gil, Py_MOD_GIL_NOT_USED},
    {0, NULL}
};
```

Single-phase modules use the unstable helper in free-threaded builds:

```c
#ifdef Py_GIL_DISABLED
PyUnstable_Module_SetGIL(module, Py_MOD_GIL_NOT_USED);
#endif
```

Audit extension code for direct object-field reads, borrowed references from mutable containers, global caches, and allocator-domain mistakes. Replace borrowed-reference APIs with strong-reference variants when concurrent mutation is possible, and add explicit locks around extension-owned shared state.

### Reading Strategy

Follow this order:

1. Read `Doc/howto/free-threading-python.rst` for user-visible behavior.
2. Read `Python/ceval_gil.c` and `Include/internal/pycore_gil.h` for the lock state and transition logic.
3. Read `Python/pystate.c` for thread attachment and detachment.
4. Read `Doc/howto/free-threading-extensions.rst` to understand extension compatibility pressure.
5. Return to object and memory files to see how reference counting changes under `Py_GIL_DISABLED`.

The core rule is simple: in default CPython, the GIL is the broad runtime guard; in free-threaded CPython, CPython moves that guard into object, thread-state, allocator, and extension-specific mechanisms.

---
id: ch10
title: Chapter 10 — Worked Linux Read Trace
fileRecommendations:
  readingOrder:
    - path: Modules/posixmodule.c:os_read_impl
      description: Python os.read implementation and byte-result allocation
      type: source
    - path: Python/fileutils.c:_Py_read
      description: Thread-state detachment, interruption handling, and error conversion
      type: source
    - path: repo:bminor/glibc/sysdeps/unix/sysv/linux/read.c:__libc_read
      description: glibc cancellation-aware read wrapper
      type: source
    - path: repo:torvalds/linux/arch/arm64/kernel/syscall.c:do_el0_svc
      description: AArch64 system-call dispatch
      type: source
    - path: repo:torvalds/linux/fs/read_write.c:ksys_read
      description: Kernel descriptor lookup and VFS read entry
      type: source
---

Use an unbuffered descriptor operation to isolate the boundary:

```python
import os

reader, writer = os.pipe()
os.write(writer, b"abc")
os.close(writer)
try:
    print(os.read(reader, 16))  # b'abc': a read can return fewer bytes
    print(os.read(reader, 16))  # b'': the closed pipe has reached EOF
finally:
    os.close(reader)
```

[os_read_impl](Modules/posixmodule.c:os_read_impl) validates the requested size, allocates the bytes result, and calls [_Py_read](Python/fileutils.c:_Py_read). The latter limits the request, detaches the Python thread state around the C read, saves errno, and reattaches before checking Python signals. In a GIL-enabled build, that blocking region releases the GIL; a free-threaded build still needs thread-state coordination.

On Linux linked against glibc, the call reaches [__libc_read](repo:bminor/glibc/sysdeps/unix/sysv/linux/read.c:__libc_read). This uses SYSCALL_CANCEL, which provides pthread cancellation-point handling around the architecture-specific syscall machinery. POSIX cancellation is distinct from a Python signal handler raising an exception.

For AArch64, follow [the wrapper macros](repo:bminor/glibc/sysdeps/unix/sysv/linux/aarch64/sysdep.h), Linux's [exception entry](repo:torvalds/linux/arch/arm64/kernel/entry-common.c:el0t_64_sync_handler), and [syscall dispatch](repo:torvalds/linux/arch/arm64/kernel/syscall.c:do_el0_svc). The read syscall handler reaches [ksys_read](repo:torvalds/linux/fs/read_write.c:ksys_read), which resolves the descriptor and enters vfs_read. A pipe, terminal, socket, and regular file can have different downstream behavior; this example does not imply disk I/O.

On return, _Py_read retries EINTR only while the Python signal check does not report an exception. Other failures become Python exceptions through the errno conversion. os_read_impl shrinks the bytes result to the count actually read. A nonblocking empty descriptor can raise BlockingIOError rather than return EOF.

A buffered Python file adds another layer: [BufferedReader](Modules/_io/bufferedio.c) may serve reads without a syscall or prefetch more bytes than the caller requested; its raw [FileIO read](Modules/_io/fileio.c:_io_FileIO_read_impl) uses _Py_read. Text decoding adds another layer again. On a Linux development host, trace a saved example with:

```sh
strace -e trace=read,write python3.14 example.py
```

Account for interpreter-startup reads before identifying the pipe descriptors.

---
id: ch11
title: Chapter 11 — Allocation Has Multiple Routes to Linux
fileRecommendations:
  readingOrder:
    - path: Doc/c-api/memory.rst
      description: Raw, memory, and object domains plus allocator configuration
      type: docs
    - path: Objects/obmalloc.c:_PyMem_ArenaAlloc
      description: Arena allocation using mappings where available
      type: source
    - path: Objects/obmalloc.c:_PyMem_RawMalloc
      description: Raw allocation through the platform malloc interface
      type: source
    - path: repo:bminor/glibc/malloc/malloc.c:__libc_malloc
      description: C-library allocation and reuse
      type: source
    - path: repo:torvalds/linux/mm/mmap.c:do_mmap
      description: Virtual-memory mapping construction
      type: source
---

Choose the allocator domain and build mode before following a request. [The memory API documentation](Doc/c-api/memory.rst) distinguishes raw allocation, PyMem allocation, and object allocation; allocators can also be configured or replaced. Python object lifetime does not determine one universal C-library call chain.

| Configuration or request | CPython route | Possible platform boundary |
| --- | --- | --- |
| Default pymalloc, small request up to 512 bytes | Reuse a block from a pymalloc pool; get an arena when needed | [_PyMem_ArenaAlloc](Objects/obmalloc.c:_PyMem_ArenaAlloc) uses mmap when its mapping support is enabled |
| Default pymalloc, larger request | Fall back to the raw allocator | [_PyMem_RawMalloc](Objects/obmalloc.c:_PyMem_RawMalloc) calls malloc |
| Free-threaded object allocation | Mimalloc-backed object allocation | Follow [mimalloc OS allocation](Objects/mimalloc/os.c) and its [Unix primitives](Objects/mimalloc/prim/unix/prim.c:_mi_prim_alloc) |
| Custom allocator or changed configuration | Selected domain's installed callbacks | Follow the configured allocator implementation |

A pymalloc arena mapping can pass through [glibc's mmap implementation](repo:bminor/glibc/sysdeps/unix/sysv/linux/mmap64.c:__mmap64) to Linux's [mapping machinery](repo:torvalds/linux/mm/mmap.c:do_mmap), without a glibc malloc call for that arena. The raw malloc route instead enters [__libc_malloc](repo:bminor/glibc/malloc/malloc.c:__libc_malloc). glibc can reuse cached chunks or arena space; requests for more address space can use brk or mmap. Neither a Python allocation nor a C malloc call guarantees a syscall.

Object deallocation, allocator reuse, virtual-memory release, and physical-page reclamation are different events. A reference count reaching zero does not promise that RSS drops. [Mappings](repo:torvalds/linux/mm/mmap.c) establish address ranges; [page-fault handling](repo:torvalds/linux/mm/memory.c:handle_mm_fault) can populate ordinary anonymous mappings later. Avoid equating a successful mapping with immediate allocation of every physical page.

For an experiment, record build mode and PYTHONMALLOC configuration, then compare Python-level allocation observations with Linux mapping/syscall observations. A direct mmap can belong to an allocator arena, an extension, or a mapped file. Attribute it with a stack trace or source path before claiming that it represents one Python object.

---
id: ch12
title: Chapter 12 — Python Threads, POSIX Threads, and Linux Tasks
fileRecommendations:
  readingOrder:
    - path: Lib/threading.py
      description: Thread.start and the joinable-thread entry
      type: source
    - path: Modules/_threadmodule.c:ThreadHandle_start
      description: Thread bootstrap state and native thread creation
      type: source
    - path: Python/thread_pthread.h:PyThread_start_joinable_thread
      description: CPython POSIX thread adapter
      type: source
    - path: repo:bminor/glibc/nptl/pthread_create.c:__pthread_create_2_1
      description: POSIX thread stack, TLS, descriptor, and child startup
      type: source
    - path: repo:bminor/glibc/sysdeps/unix/sysv/linux/clone-internal.c:__clone_internal
      description: clone3 selection and clone fallback
      type: source
    - path: repo:torvalds/linux/kernel/fork.c:kernel_clone
      description: Kernel task creation
      type: source
---

Follow [Thread.start](Lib/threading.py) to the imported _thread.start_joinable_thread entry. [The C module](Modules/_threadmodule.c:thread_PyThread_start_joinable_thread) reaches [ThreadHandle_start](Modules/_threadmodule.c:ThreadHandle_start), which prepares bootstrap state and calls the native joinable-thread API. The POSIX implementation, [PyThread_start_joinable_thread](Python/thread_pthread.h:PyThread_start_joinable_thread), uses a helper that calls pthread_create.

In glibc, [pthread_create](repo:bminor/glibc/nptl/pthread_create.c:__pthread_create_2_1) arranges thread metadata, stack/TLS resources, and the child start routine. Its creation helper calls [__clone_internal](repo:bminor/glibc/sysdeps/unix/sysv/linux/clone-internal.c:__clone_internal). That wrapper attempts clone3 on supported build paths and falls back to clone when clone3 is unavailable with ENOSYS. Architecture and configuration affect the selected route; this is not a promise that every pthread creation issues clone3.

The corresponding Linux clone-family syscall reaches [kernel_clone](repo:torvalds/linux/kernel/fork.c:kernel_clone), which creates a task with the requested sharing semantics. A pthread is not a forked process with an independent address space. In the child, glibc calls CPython's [pthread-signature adapter](Python/thread_pthread.h:pythread_wrapper), which invokes the [thread_run bootstrap](Modules/_threadmodule.c:thread_run). The bootstrap coordinates Python thread state before calling the Python callable.

The existence of native tasks does not determine whether their Python bytecode executes in parallel. The default interpreter's GIL constrains threads sharing that GIL; a free-threaded build and per-interpreter GIL configurations have different execution rules. Likewise, releasing a lock is not a guarantee that Linux schedules a particular waiter next.

On a Linux development host, save a small threading.Thread example and trace it with:

```sh
strace -f -e trace=clone,clone3,futex python3.14 example.py
```

Futex traffic can come from the GIL, joins, libc locks, or other runtime components. Identify the relevant synchronization object before assigning every futex call to the GIL.

---
id: ch13
title: Chapter 13 — Executable Startup and Extension Loading
fileRecommendations:
  readingOrder:
    - path: repo:torvalds/linux/fs/binfmt_elf.c:load_elf_binary
      description: Executable segments, PT_INTERP, and initial user entry
      type: source
    - path: repo:bminor/glibc/elf/rtld.c:_dl_start
      description: Dynamic loader initialization
      type: source
    - path: repo:bminor/glibc/csu/libc-start.c:__libc_start_main
      description: Application C-runtime startup
      type: source
    - path: Programs/python.c:main
      description: CPython's platform main entry
      type: source
    - path: Modules/main.c:Py_BytesMain
      description: Interpreter configuration and execution orchestration
      type: source
    - path: Python/dynload_shlib.c:_PyImport_FindSharedFuncptr
      description: dlopen and extension initializer symbol lookup
      type: source
---

For a dynamically linked ELF CPython executable, Linux's [ELF loader](repo:torvalds/linux/fs/binfmt_elf.c:load_elf_binary) maps the executable and its PT_INTERP interpreter. Initial user-space execution goes to that interpreter's entry, not straight to the application's entry. glibc's [runtime loader](repo:bminor/glibc/elf/rtld.c:_dl_start) arranges dependencies, relocations, TLS, and initialization before transferring to the application's startup path.

On AArch64, [application _start](repo:bminor/glibc/sysdeps/aarch64/start.S) calls [__libc_start_main](repo:bminor/glibc/csu/libc-start.c:__libc_start_main). That startup reaches [CPython's main](Programs/python.c:main), which calls [Py_BytesMain](Modules/main.c:Py_BytesMain) on the Unix path. CPython then handles configuration, interpreter initialization, and the selected script, module, or interactive command. A statically linked executable, a static PIE, and an embedding host need their own startup analysis.

Loading an extension later is a separate operation. importlib's [extension loader](Lib/importlib/_bootstrap_external.py:ExtensionFileLoader) uses the extension-import machinery in [Python/import.c](Python/import.c). For the shared-library route, [_PyImport_FindSharedFuncptr](Python/dynload_shlib.c:_PyImport_FindSharedFuncptr) calls dlopen with configured flags, then looks up the expected initialization symbol with dlsym. A built-in or frozen module does not follow this shared-library route.

The glibc boundaries are [dlopen](repo:bminor/glibc/dlfcn/dlopen.c:___dlopen), [_dl_open](repo:bminor/glibc/elf/dl-open.c:_dl_open), and [symbol lookup](repo:bminor/glibc/dlfcn/dlsym.c:___dlsym). Mapping and relocation happen inside the existing process. Linux may service mappings and faults, but extension import does not repeat execve or restart Python. The later module initialization and its GIL compatibility checks remain CPython responsibilities.

Inspect the actual Linux executable with these commands, replacing the path with the interpreter being investigated:

```sh
readelf -l /path/to/python3.14
readelf -d /path/to/python3.14
```

The program headers identify PT_INTERP; the dynamic section supplies dependency metadata. Compare startup loader activity with importing a known dynamically built extension using LD_DEBUG on glibc. Exact libraries and initializer behavior depend on how that interpreter and extension were built; a source tag alone does not determine the installed binary's linkage.

---
## References

- [CPython 3.14.0 release notes](https://github.com/python/cpython/blob/v3.14.0/Doc/whatsnew/3.14.rst) — Version-pinned free-threading status, interpreter changes, and incremental GC
- [CPython 3.14.0 thread-state documentation](https://github.com/python/cpython/blob/v3.14.0/Doc/c-api/init.rst) — GIL ownership, subinterpreters, and C API attachment
- [CPython 3.14.0 extension import implementation](https://github.com/python/cpython/blob/v3.14.0/Python/import.c) — GIL compatibility fallback and explicit overrides
- [Python Developer's Guide](https://devguide.python.org/) — Official Python development guide
- [Exploring CPython's Internals](https://devguide.python.org/internals/exploring/) — Official guide to exploring CPython
- [Python Documentation](https://docs.python.org/) — Official Python documentation
---
