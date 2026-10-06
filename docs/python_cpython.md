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
---

# CPython In The Mind

## Understanding CPython Before Code

> This isn't a guide to writing Python code. It's an effort to understand how CPython thinks.

CPython is the reference implementation of Python, written in C. It compiles Python source code to bytecode and executes it on a virtual machine. Understanding CPython's internals reveals how Python's elegant syntax translates into efficient execution, how objects are managed in memory, and how the interpreter orchestrates program execution.

This guide targets CPython 3.14.0. Some details differ from older walkthroughs: bytecode cases are generated from `Python/bytecodes.c`, selected instructions specialize at runtime, and the source includes both default-GIL and free-threaded build paths.

This guide is for anyone who wants to build a mental model of how CPython works—before diving deep into the source code. Whether you're exploring Python internals for the first time or returning with new questions, the focus here is on **behavior, not syntax**.

**CPython runs Python. Let's understand how it runs.**

---
id: ch1
title: Chapter 1 — Understanding CPython Before Code
fileRecommendations:
  readingOrder:
    - path: Doc/c-api/
      description: Python C API reference
      type: docs
    - path: Doc/extending/
      description: Extending Python with C
      type: docs
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
    - path: Modules/gcmodule.c:gc_collect_main
      description: Cyclic garbage collector
      type: source
---


### CPython Compiles and Interprets Code

CPython is both a compiler and an interpreter. It compiles Python source code to bytecode, then executes that bytecode on a stack-based virtual machine. Understanding this dual nature reveals how Python achieves its balance between high-level expressiveness and runtime efficiency. The compilation phase handles syntax analysis and optimization, while the interpreter handles execution, memory management, and dynamic behavior.

### Everything Is an Object: The Foundation of Python

In Python, everything is an object—integers, functions, classes, modules, even types themselves. This uniform object model simplifies the language design and enables powerful features like introspection, dynamic typing, and metaprogramming. Understanding this principle reveals how CPython manages memory, implements polymorphism, and provides a consistent interface across all language constructs.

Key files: [Include/object.h](Include/object.h) defines `PyObject`, and [Objects/typeobject.c](Objects/typeobject.c) implements the type system.

### The Global Interpreter Lock (GIL): Concurrency in CPython

In the default CPython build, the Global Interpreter Lock (GIL) protects access to Python objects and prevents native threads from executing Python bytecode at the same time. CPython 3.14 also contains free-threaded build paths guarded by `Py_GIL_DISABLED`, so read GIL-related code with the build mode in mind. For the lower layers, compare glibc's [`pthread_create`](repo:bminor/glibc/nptl/pthread_create.c:pthread_create) with Linux's [`kernel_clone`](repo:torvalds/linux/kernel/fork.c:kernel_clone): a Python thread ultimately depends on both the POSIX user-space API and a kernel task.

See [Doc/c-api/init.rst](Doc/c-api/init.rst) for interpreter initialization and the GIL lifecycle.

### Memory Management: Reference Counting and Garbage Collection

CPython uses a combination of reference counting and a cyclic garbage collector for memory management. Most objects are deallocated when their reference count reaches zero, while selected constants and runtime singletons can be immortal. Free-threaded builds also split some reference-count operations into local and shared paths. Reference counting alone cannot handle circular references, so CPython includes a garbage collector that detects and collects cycles.

See [Doc/c-api/gcsupport.rst](Doc/c-api/gcsupport.rst) for garbage collector support documentation.

---
id: ch2
title: Chapter 2 — Source Code Structure
fileRecommendations:
  readingOrder:
    - path: Doc/
      description: Official Python documentation source
      type: docs
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
      description: Type system (about 10,600 lines)
      type: source
    - path: Include/object.h:PyObject_HEAD
      description: PyObject and PyTypeObject definitions
      type: source
    - path: Parser/tokenizer.c
      description: Lexical analysis — source to tokens
      type: source
    - path: Grammar/python.gram
      description: PEG grammar used to generate the parser
      type: source
---


```chapter-graph
Parser/tokenizer.c -> Parser/parser.c : tokens → AST
Grammar/python.gram -> Parser/parser.c : pegen generates parser
Parser/parser.c -> Python/ast.c : parse tree → AST
Python/ast.c -> Python/compile.c : AST → bytecode
Python/compile.c -> Include/opcode_ids.h : emits opcode IDs
Python/bytecodes.c -> Python/generated_cases.c.h : generate instruction cases
Python/generated_cases.c.h -> Python/ceval.c : bytecode execution cases
Python/frame.c -> Python/ceval.c : execution context
```

### A Walk Through the CPython Source: Understanding Its Organization

The CPython source code is organized into clear directories, each serving a specific purpose. The main areas are: `Python/` (core interpreter), `Objects/` (object implementations), `Include/` (headers), `Parser/` (lexing and parsing), `Modules/` (C extension modules), and `Lib/` (pure Python stdlib).

**Key File Statistics:**

- Total C code: about 500,000 lines
- Core interpreter ([Python/](Python/)): about 100,000 lines
- Object implementations ([Objects/](Objects/)): about 150,000 lines
- Standard library ([Lib/](Lib/)): about 500,000+ lines of Python

### The Compilation Pipeline: From Source to Bytecode

CPython's compilation process transforms Python source code into bytecode through tokenization, PEG parsing, AST construction, and bytecode generation. In 3.14, the parser is generated from `Grammar/python.gram`, and the interpreter instruction cases are generated from `Python/bytecodes.c`.

Key files in the pipeline:
- [Parser/tokenizer.c](Parser/tokenizer.c) — Tokenizes Python source code
- [Grammar/python.gram](Grammar/python.gram) — Grammar consumed by pegen
- [Parser/parser.c](Parser/parser.c) — Generated parser for tokens and grammar rules
- [Python/ast.c](Python/ast.c) — AST manipulation and validation
- [Python/compile.c](Python/compile.c) — Compiles AST to bytecode

### The Execution Model: Bytecode to Results

CPython executes bytecode using a stack-based interpreter. The main frame executor lives in [Python/ceval.c](Python/ceval.c), while instruction bodies are defined in [Python/bytecodes.c](Python/bytecodes.c) and generated into [Python/generated_cases.c.h](Python/generated_cases.c.h). The interpreter manipulates stack references, maintains frames, specializes hot operations, and may hand optimized traces to tier-two executor machinery.

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
      description: PyObject and PyTypeObject definitions
      type: source
    - path: Objects/object.c
      description: Base object implementation
      type: source
    - path: Objects/typeobject.c:type_new
      description: Type system (about 10,600 lines)
      type: source
    - path: Modules/gcmodule.c:gc_collect_main
      description: Cyclic garbage collector
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
Modules/gcmodule.c -> Include/internal/pycore_gc.h : cyclic GC tracks PyObject
```

### PyObject: The Base of Everything

All Python objects in CPython are represented by structures that begin with `PyObject` (or `PyObject_HEAD`). This common header contains the object's type pointer and reference count. This design enables polymorphism: any function that accepts a `PyObject*` can work with any Python object, and the type system determines the correct behavior at runtime.

Key files:
- [Objects/object.c](Objects/object.c) — Base object implementation
- [Include/object.h](Include/object.h) — Object structure definitions
- [Objects/typeobject.c](Objects/typeobject.c) — Type object implementation

### Type Objects: Defining Behavior

In Python, types are themselves objects. The `PyTypeObject` structure defines how objects of a particular type behave: what methods they support, how they're created, how they're compared, and how they're represented as strings. Understanding type objects reveals how Python's dynamic typing and method resolution work.

Key files:
- [Objects/typeobject.c](Objects/typeobject.c) — Type object implementation (about 10,600 lines)
- [Include/cpython/object.h](Include/cpython/object.h) — Type object structure internals
- [Objects/abstract.c](Objects/abstract.c) — Abstract object protocol

See [Doc/c-api/typeobj.rst](Doc/c-api/typeobj.rst) for the full type object slot reference.

### Reference Counting: Automatic Memory Management

CPython uses reference counting as its primary memory management mechanism. Ordinary objects are deallocated when their count reaches zero, but CPython 3.14 also uses immortal objects for selected constants and has alternate local/shared reference-count paths in free-threaded builds. The memory below CPython's object layer is a useful cross-reference: glibc's [`__libc_malloc`](repo:bminor/glibc/malloc/malloc.c:__libc_malloc) manages user-space heap storage, while Linux's [`do_mmap`](repo:torvalds/linux/mm/mmap.c:do_mmap) creates the virtual-memory areas that back larger mappings.

The macros `Py_INCREF` and `Py_DECREF` in [Objects/object.c](Objects/object.c) and [Include/object.h](Include/object.h) provide reference counting.

### Garbage Collection: Handling Cycles

While reference counting handles most memory management, it cannot detect or break circular references. CPython includes a cyclic garbage collector that periodically scans for unreachable cycles and collects them. Understanding the garbage collector reveals how CPython handles complex object graphs and why some objects may survive until a later collection.

Key files:
- [Modules/gcmodule.c](Modules/gcmodule.c) — Garbage collector implementation
- [Include/internal/pycore_gc.h](Include/internal/pycore_gc.h) — GC internal definitions

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
      description: Unicode string implementation (about 15,000 lines)
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
Objects/unicodeobject.c -> Objects/dictobject.c : str keys are interned
```

### Integers: Arbitrary Precision

Python integers have arbitrary precision, meaning they can represent numbers of any size limited only by available memory. CPython implements this using a variable-length representation that allocates more memory as numbers grow larger. Understanding integer implementation reveals how Python achieves both performance for small numbers and correctness for large ones.

Key files:
- [Objects/longobject.c](Objects/longobject.c) — Integer implementation
- [Include/cpython/longintrepr.h](Include/cpython/longintrepr.h) — Integer representation

### Strings: Unicode and Immutability

Python strings are immutable sequences of Unicode code points. CPython uses distinct internal representations to optimize for different string characteristics (ASCII, compact Unicode, or legacy strings). Understanding string implementation reveals how Python handles text encoding, string interning, and memory efficiency.

Key files:
- [Objects/unicodeobject.c](Objects/unicodeobject.c) — Unicode string implementation (about 15,000 lines)
- [Include/unicodeobject.h](Include/unicodeobject.h) — Unicode object definitions

### Lists: Dynamic Arrays

Python lists are implemented as dynamic arrays (like C++'s `std::vector`). They maintain a contiguous block of pointers to objects, automatically resizing when capacity is exceeded. Understanding list implementation reveals how Python achieves O(1) indexing while supporting dynamic growth.

Key files:
- [Objects/listobject.c](Objects/listobject.c) — List implementation
- [Include/listobject.h](Include/listobject.h) — List object definitions

### Dictionaries: Hash Tables

Python dictionaries are implemented as hash tables with open addressing. They use a clever probing strategy and maintain insertion order (as of Python 3.7). Understanding dictionary implementation reveals how Python achieves average O(1) lookups while maintaining predictable iteration order.

Key files:
- [Objects/dictobject.c](Objects/dictobject.c) — Dictionary implementation (about 5,850 lines)
- [Include/dictobject.h](Include/dictobject.h) — Dictionary object definitions

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
    - path: Include/frameobject.h
      description: Frame object structure
      type: source
    - path: Lib/dis.py:dis
      description: Python bytecode disassembler
      type: source
---


```chapter-graph
Python/bytecodes.c -> Python/generated_cases.c.h : instruction definitions generate cases
Python/generated_cases.c.h -> Python/ceval.c : included by the frame executor
Python/compile.c -> Include/opcode_ids.h : compiler emits opcode IDs
Python/ceval.c -> Python/frame.c : creates frame per call
Include/frameobject.h -> Python/frame.c : frame struct definition
Python/frame.c -> Python/compile.c : reads f_code (PyCodeObject)
Include/opcode_ids.h -> Lib/dis.py : disassembler decodes generated opcode IDs
```

### The Main Loop: ceval.c

The heart of CPython is the frame executor in [Python/ceval.c](Python/ceval.c), centered on `_PyEval_EvalFrameDefault`. In 3.14, most instruction behavior is written in [Python/bytecodes.c](Python/bytecodes.c) and generated into [Python/generated_cases.c.h](Python/generated_cases.c.h). The loop manipulates stack references, checks eval-breaker events, specializes hot instructions, and supports tier-two executor paths.

Key files:
- [Python/ceval.c](Python/ceval.c) — Frame execution and eval-loop control
- [Python/bytecodes.c](Python/bytecodes.c) — Instruction definitions and specialization families
- [Python/generated_cases.c.h](Python/generated_cases.c.h) — Generated cases consumed by `ceval.c`
- [Include/opcode_ids.h](Include/opcode_ids.h) — Generated opcode identifiers

### Frames: Execution Context

Each function call creates a new execution frame that contains local variables, the value stack, and execution state. Frames are linked together to form a call stack, enabling function calls, returns, and exception propagation. Understanding frames reveals how Python manages execution context and enables features like generators and coroutines.

Key files:
- [Python/frame.c](Python/frame.c) — Frame object implementation
- [Include/frameobject.h](Include/frameobject.h) — Frame object definitions

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
      type: source
---


```chapter-graph
Python/import.c -> Objects/moduleobject.c : creates module objects
Objects/moduleobject.c -> Include/moduleobject.h : module struct + API
Python/import.c -> Python/ceval.c : IMPORT_NAME opcode handler
Python/ceval.c -> Python/import.c : calls PyImport_ImportModuleLevelObject
```

### The Import System: Loading Code Dynamically

Python's import system finds, loads, and initializes modules. It searches through a list of paths (sys.path), caches loaded modules, and handles both built-in modules (written in C) and Python modules. Understanding the import system reveals how Python organizes code and enables dynamic program structure.

Key files:
- [Python/import.c](Python/import.c) — Import system implementation
- [Lib/importlib/](Lib/importlib/) — Import library (Python implementation)

Importing an extension or shared library also crosses repository boundaries: glibc's [`_dl_start`](repo:bminor/glibc/elf/rtld.c:_dl_start) begins dynamic-linker startup, and Linux's [`load_elf_binary`](repo:torvalds/linux/fs/exec.c:load_elf_binary) maps executable segments before control reaches user space. Pure Python imports still travel through bytecode such as `IMPORT_NAME` and the `importlib` bootstrap code.

### Module Objects: Namespaces as Objects

In Python, modules are objects that serve as namespaces for code organization. Module objects contain a dictionary of their attributes and maintain metadata about their location and loading. Understanding module objects reveals how Python's namespace system works and how code is organized and accessed.

Key files:
- [Objects/moduleobject.c](Objects/moduleobject.c) — Module object implementation
- [Include/moduleobject.h](Include/moduleobject.h) — Module object definitions

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
Python/errors.c -> Python/traceback.c : attaches traceback on raise
Python/traceback.c -> Include/traceback.h : tb_frame chain definition
Python/ceval.c -> Python/errors.c : RAISE_VARARGS opcode calls PyErr_SetObject
```

### Exceptions: Error Propagation

Python's exception system provides a structured way to handle errors and propagate them through the call stack. Exceptions are objects that can be raised, caught, and inspected. CPython implements exceptions using a combination of bytecode instructions and C-level error flag checking for efficient propagation.

Key files:
- [Python/errors.c](Python/errors.c) — Exception handling machinery
- [Objects/exceptions.c](Objects/exceptions.c) — Built-in exception types
- [Include/pyerrors.h](Include/pyerrors.h) — Exception declarations

### Tracebacks: Understanding Errors

When an exception is raised, Python builds a traceback object that records the call stack at the point of the error. This traceback provides detailed information about where the error occurred and how execution reached that point. Understanding tracebacks reveals how Python provides helpful error messages and debugging information.

Key files:
- [Python/traceback.c](Python/traceback.c) — Traceback implementation
- [Include/traceback.h](Include/traceback.h) — Traceback definitions

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
      type: docs
    - path: Doc/extending/
      description: Extending Python with C
      type: docs
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

Key files:
- [Objects/descrobject.c](Objects/descrobject.c) — Descriptor implementation
- [Include/descrobject.h](Include/descrobject.h) — Descriptor definitions

### Generators and Coroutines: Pausable Execution

Python generators and coroutines enable pausable execution through the use of special frame objects that can be suspended and resumed. Understanding how generators work reveals how Python implements iteration, async/await, and other advanced control flow features.

Key files:
- [Objects/genobject.c](Objects/genobject.c) — Generator and coroutine implementation
- [Include/cpython/genobject.h](Include/cpython/genobject.h) — Generator definitions

### The C API: Extending Python

CPython provides a comprehensive C API for extending Python with C code or embedding Python in C applications. Understanding the C API reveals how Python's features are implemented and how high-performance extensions connect to the runtime.

Key files:
- [Include/Python.h](Include/Python.h) — Main C API header (includes everything)
- [Include/object.h](Include/object.h) — Object API
- [Include/pyerrors.h](Include/pyerrors.h) — Exception API

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

In the default build, the GIL protects Python object internals and serializes bytecode execution across native threads. Threads still overlap during I/O or C code that releases the GIL, but two Python threads do not run Python bytecode at the same instant.

`Python/ceval_gil.c` is the center of this model. It stores the GIL state, implements the switch interval, handles drop requests, and attaches or detaches thread states around blocking regions.

```c
// Conceptual default-build shape.
take_gil(tstate);
_PyEval_EvalFrameDefault(tstate, frame, throwflag);
drop_gil(interp, tstate, 0);
```

The actual interpreter uses more detailed control flow, but this shape captures the invariant: a thread must own the runtime's execution permission before it mutates ordinary Python runtime state.

### Free-Threaded Build: GIL Optional, Synchronization Localized

The free-threaded build is selected at build time with GIL support disabled. In that build, `Py_GIL_DISABLED` activates alternate paths across the runtime. CPython replaces the single global protection point with more localized mechanisms: biased reference counting, object-level synchronization, critical sections, deferred refcount merging, and stop-the-world coordination for runtime-wide events.

Use these runtime checks when experimenting:

```python
import sys
import sysconfig

print(sys.version)
print(sysconfig.get_config_var("Py_GIL_DISABLED"))
print(sys._is_gil_enabled())
```

The build can support free threading while the process still has the GIL enabled. Python 3.14 exposes runtime controls through `PYTHON_GIL` and `-X gil`, and importing a C extension that has not declared free-threading support can enable the GIL for compatibility.

### Thread State Still Matters

Free-threaded does not mean unmanaged. A native thread must still attach to the interpreter before it calls Python C API functions. Existing APIs such as `PyGILState_Ensure`, `PyGILState_Release`, `PyEval_SaveThread`, and `PyEval_RestoreThread` remain relevant because they manage thread state attachment even when no global lock is active.

```c
PyGILState_STATE state = PyGILState_Ensure();
/* Safe to call Python C API with an attached thread state. */
PyGILState_Release(state);
```

Read `Python/pystate.c` beside `Python/ceval_gil.c`: the first file explains which thread state is current, while the second explains whether that attached thread must also own the GIL.

### C Extensions: Declare Safety or Re-Enable the GIL

C extensions are the compatibility boundary. An extension built around old assumptions may rely on the GIL to protect borrowed references, global caches, or direct struct-field access. Python 3.14 asks extensions to declare free-threading support. Without that declaration, importing the extension can enable the GIL at runtime.

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
## References

- [Python Developer's Guide](https://devguide.python.org/) — Official Python development guide
- [Exploring CPython's Internals](https://devguide.python.org/internals/exploring/) — Official guide to exploring CPython
- [Python Documentation](https://docs.python.org/) — Official Python documentation
---
