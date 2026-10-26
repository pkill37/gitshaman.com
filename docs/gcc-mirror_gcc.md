---
curatedRepoId: gcc-15.2.0
owner: gcc-mirror
repo: gcc
revision: 5115c7e447fc07457443df874bf57840e8316d5f
guideId: gcc-guide
name: GCC In The Mind
description: Trace GCC from the command-line driver through GIMPLE, SSA, RTL, and target code generation
defaultOpenIds:
  - ch1
  - ch2
  - ch3
  - ch4
  - ch5
  - ch6
  - ch7
  - ch8
---

# GCC In The Mind

GCC is a collection of language front ends, shared optimization machinery, target back ends, and runtime libraries. Its command-line driver coordinates compiler, assembler, and linker programs. Inside the compiler proper, source code moves through representations designed for different jobs: language trees, GIMPLE, SSA form, and RTL.

This guide follows GCC 15.2 at the pinned release commit. Start with a small C function and keep its source, compiler options, target, intermediate dumps, and assembly together. Each chapter answers a question about one transformation and links to the files that own it. Treat this as a source-reading route, with full compiler builds performed in a separate local checkout.

For build prerequisites and supported configurations, use the [installation manual in this snapshot](gcc/doc/install.texi). The [GCC internals overview](gcc/doc/gccint.texi) and [pass documentation](gcc/doc/passes.texi) provide the vocabulary for following implementation files. Compare GCC with [LLVM](repo:llvm/llvm-project/llvm/docs/CodeGenerator.rst) after understanding each compiler's own representations.

---
id: ch1
title: Chapter 1 — Set Up a Compiler Investigation
fileRecommendations:
  readingOrder:
    - path: README
      description: Project context and documentation entry points
      type: docs
    - path: gcc/doc/install.texi
      description: Prerequisites, configuration, bootstrap, and testing instructions
      type: docs
    - path: configure.ac
      description: Top-level configuration and component selection
      type: source
    - path: gcc/gcc.cc
      description: Driver options, specs, and subprocess orchestration
      type: source
    - path: gcc/main.cc
      description: Entry point for the compiler proper
      type: source
---

A native compiler runs on the same kind of machine it targets. A cross compiler runs on the host but emits code for another target. The build machine is where the compiler itself is built. Keep these identities separate when reading configuration tests or diagnosing a missing assembler, header, or runtime library.

Read [the installation instructions](gcc/doc/install.texi) before configuring. Use a separate build directory, select the languages needed for the experiment, and keep the source tree separate from generated output. A native bootstrap builds successive compiler stages; compare that process with the configuration needed for a cross compiler. Avoid disabling bootstrap merely to hide a stage-comparison failure.

The program named `gcc` is a driver. [Its implementation](gcc/gcc.cc) interprets options and specs, selects subprocesses, and connects compilation, assembly, and linking. [The compiler entry point](gcc/main.cc) leads into [toplev](gcc/toplev.cc:toplev::main), where compilation is coordinated. The assembler and linker are separate tools; their execution does not make their implementations part of GCC.

For a first experiment, save this function as the input named in the commands below:

```c
int add_positive(int left, int right)
{
  int sum = left + right;
  return sum > 0 ? sum : 0;
}
```

Record the compiler version and target, then inspect driver commands before changing source:

```sh
gcc --version
gcc -dumpmachine
gcc -### -O2 -c example.c
gcc -O2 -S example.c -o example.s
```

The command display and assembly answer different questions. The former shows orchestration; the latter shows the output after the compiler's transformations. Use the configured compiler from the chosen build when investigating this exact revision.

---
id: ch2
title: Chapter 2 — Front Ends Turn Language Rules into Trees
fileRecommendations:
  readingOrder:
    - path: libcpp/lex.cc
      description: Preprocessor tokenization
      type: source
    - path: gcc/c/c-parser.cc
      description: C parsing and statement construction
      type: source
    - path: gcc/c/c-typeck.cc
      description: C expression typing and semantic checks
      type: source
    - path: gcc/cp/parser.cc
      description: C++ parsing with language-specific rules
      type: source
    - path: gcc/tree.def
      description: Shared tree node kinds
      type: source
---

The front end must preserve the source language's meaning before shared optimization begins. Tokenization, parsing, name lookup, typing, and diagnostics are related tasks with different owners. Start with [preprocessor lexing](libcpp/lex.cc), then inspect [the C parser](gcc/c/c-parser.cc) and [C semantic checking](gcc/c/c-typeck.cc). For an expression, distinguish where syntax is recognized from where operand types and conversions are checked.

Use [the C++ parser](gcc/cp/parser.cc) as a comparison. Templates, overloads, and other C++ rules belong to a language front end; they are not extra instructions in the target back end. [The tree node definitions](gcc/tree.def) supply shared forms, while language-specific structures keep information needed before lowering.

Trace a small function containing an arithmetic expression and a conditional. Identify the parser routine that accepts the construct, then follow the helper that builds or checks its tree. Keep a diagnostic example beside the valid one: an invalid conversion can reveal where semantic checking takes place. Source locations matter because later diagnostics must still point back to user code after transformations.

```chapter-graph
libcpp/lex.cc -> gcc/c/c-parser.cc : preprocessing tokens enter C parsing
gcc/c/c-parser.cc -> gcc/c/c-typeck.cc : syntax construction invokes semantic checking
gcc/c/c-typeck.cc -> gcc/tree.def : checked expressions use shared tree forms
```

---
id: ch3
title: Chapter 3 — GIMPLE Makes Expressions Explicit
fileRecommendations:
  readingOrder:
    - path: gcc/gimplify.cc
      description: Lowering language trees into simpler statements
      type: source
    - path: gcc/gimple.def
      description: GIMPLE statement kinds
      type: source
    - path: gcc/gimple.h
      description: GIMPLE statement structures and accessors
      type: source
    - path: gcc/gimple-pretty-print.cc
      description: How intermediate GIMPLE is rendered in dumps
      type: source
---

A rich source expression can hide operations and side effects. Gimplification exposes work in simpler statements and temporaries so shared passes can reason about it. Begin with [the lowering implementation](gcc/gimplify.cc:gimplify_function_tree), then use [statement definitions](gcc/gimple.def) and [accessors](gcc/gimple.h) to identify the result's structure.

GIMPLE is not a synonym for SSA. Gimplification simplifies representation; SSA construction gives scalar definitions and uses a form suited to data-flow reasoning. A dump taken before SSA and one taken after SSA describe different stages of the pipeline.

Compile a small function with a call inside an expression and request a GIMPLE dump after lowering:

```sh
gcc -O1 -fdump-tree-gimple -c example.c
```

Compare the source expression with the resulting statements. Locate explicit temporaries, calls, branches, and evaluation order. The exact temporary names are compiler output rather than a stable interface. If a dump's notation is confusing, inspect [the GIMPLE printer](gcc/gimple-pretty-print.cc) alongside the statement definition. This separates an internal data structure from the textual format used to inspect it.

---
id: ch4
title: Chapter 4 — SSA Connects Definitions, Uses, and Control Flow
fileRecommendations:
  readingOrder:
    - path: gcc/tree-ssa.cc
      description: SSA support and verification
      type: source
    - path: gcc/tree-into-ssa.cc
      description: Construction of SSA form
      type: source
    - path: gcc/tree-ssa-operands.cc
      description: Operand and use bookkeeping for GIMPLE statements
      type: source
    - path: gcc/tree-ssa-dce.cc
      description: Dead-code elimination over the SSA representation
      type: source
---

In SSA form, a scalar name has one defining assignment. Uses refer to that definition, and PHI nodes describe the value selected by control flow entering a join. This makes data-flow relationships explicit, but it does not make every memory access an independent scalar variable. Watch the virtual operands used to track memory effects.

Read [SSA construction](gcc/tree-into-ssa.cc), then [SSA support](gcc/tree-ssa.cc) and [operand bookkeeping](gcc/tree-ssa-operands.cc). Track a local variable assigned on both sides of a conditional. Identify the incoming definitions and the merged value, then change the function so one computed value is unused.

Use [dead-code elimination](gcc/tree-ssa-dce.cc) to study a complete optimization. Find its pass declaration, the work that marks necessary statements, and the work that removes unnecessary ones. The pass requires control-flow and SSA properties; its gate checks the dead-code-elimination flag. A statement with no visible result can still matter because of side effects or control flow. Establish why removal preserves behavior before celebrating a shorter dump.

For a controlled comparison, compile the same input with two optimization levels and inspect their tree dumps. Keep language mode and target constant. Changed assembly alone does not reveal which pass caused the change; inspect intermediate stages to narrow the transformation.

---
id: ch5
title: Chapter 5 — Pass Ordering and Invariants Shape Optimization
fileRecommendations:
  readingOrder:
    - path: gcc/passes.def
      description: Declared ordering and nesting of compiler passes
      type: source
    - path: gcc/passes.cc
      description: Pass execution, property handling, and dump infrastructure
      type: source
    - path: gcc/tree-pass.h
      description: Pass classes and their required or provided properties
      type: source
    - path: gcc/tree-vect-loop.cc
      description: Loop vectorization analysis and transformation
      type: source
    - path: gcc/ipa-cp.cc
      description: Interprocedural constant propagation and specialization
      type: source
---

An optimization needs a valid input representation and must leave the representation suitable for later passes. [Pass declarations](gcc/tree-pass.h) describe properties, gates, and follow-up work. [The ordered pass list](gcc/passes.def) shows where transformations run; [the manager](gcc/passes.cc:execute_one_pass) handles execution and maintenance around them. The list is a schedule, not a guarantee that every pass runs for every invocation.

Compare two scopes of reasoning. [Loop vectorization](gcc/tree-vect-loop.cc) examines loops, memory dependencies, and profitability before choosing a transformation. [Interprocedural constant propagation](gcc/ipa-cp.cc) reasons across function boundaries. The information available to each differs when separate translation units hide definitions or link-time optimization changes visibility.

Use `-fdump-passes` to inspect the configured compiler's pass reporting. Narrow later experiments to the relevant tree or RTL dump instead of reading all output at once. Record the first dump where behavior changes and check whether a preceding pass exposed the opportunity. A later pass can remove the evidence that an earlier transformation occurred.

For comparison, read [LLVM's pass documentation](repo:llvm/llvm-project/llvm/docs/WritingAnLLVMPass.rst). Both systems schedule transformations over intermediate forms, but GCC's GIMPLE and RTL stages do not map one-to-one onto LLVM IR and its machine representations.

---
id: ch6
title: Chapter 6 — RTL Connects Optimization to the Machine
fileRecommendations:
  readingOrder:
    - path: gcc/cfgexpand.cc
      description: Expansion from GIMPLE control flow into RTL
      type: source
    - path: gcc/rtl.def
      description: RTL expression and instruction forms
      type: source
    - path: gcc/recog.cc
      description: Recognition of instruction patterns and constraints
      type: source
    - path: gcc/ira.cc
      description: Integrated register allocation
      type: source
    - path: gcc/lra.cc
      description: Local register allocation and constraint handling
      type: source
    - path: gcc/final.cc
      description: Final instruction and assembly output
      type: source
---

GIMPLE describes computations at a level useful for language-independent optimization. RTL introduces a representation closer to target operations, registers, and machine modes. Follow [control-flow expansion](gcc/cfgexpand.cc) into [RTL forms](gcc/rtl.def), then inspect the generated instructions in an RTL dump.

[Pseudo registers](gcc/ira.cc) are not physical registers promised to the program. Register allocation must fit values into the available target registers and manage spills when necessary. [Local register allocation](gcc/lra.cc) works with instruction constraints and the changes needed to meet them. [Instruction recognition](gcc/recog.cc) connects RTL with supported patterns; target constraints influence which sequences are valid.

Use a small arithmetic function and compare optimized tree output, expanded RTL, and final assembly:

```sh
gcc -O2 -fdump-tree-optimized -fdump-rtl-expand -S example.c
```

Start with one operation that survives optimization and follow its representation. Then inspect [final output](gcc/final.cc) to understand where assembly emission happens. Do not expect a permanent one-to-one mapping from source operators to instructions: folding, instruction combination, register allocation, and scheduling can change the sequence before emission.

---
id: ch7
title: Chapter 7 — A Target Is More Than an Instruction Set
fileRecommendations:
  readingOrder:
    - path: gcc/config/riscv/riscv.md
      description: RISC-V machine-description patterns
      type: source
    - path: gcc/config/riscv/riscv.cc
      description: RISC-V target hooks and code-generation helpers
      type: source
    - path: gcc/doc/md.texi
      description: Machine-description syntax and instruction constraints
      type: docs
    - path: gcc/doc/tm.texi
      description: Target hooks, calling conventions, and machine interfaces
      type: docs
    - path: libgcc/libgcc2.c
      description: Compiler runtime helpers for operations requiring support code
      type: source
---

A back end needs instruction patterns, operand constraints, register information, calling conventions, and target-specific hooks. Begin with [the machine-description manual](gcc/doc/md.texi), then choose one simple pattern in [the RISC-V description](gcc/config/riscv/riscv.md). Identify its RTL shape, constraints, conditions, and output template. Return to [the target implementation](gcc/config/riscv/riscv.cc) for the helper or hook used by that pattern.

Keep ISA selection separate from ABI selection. The ISA controls available operations; the ABI specifies interfaces such as parameter passing and data layout. [The target-machine manual](gcc/doc/tm.texi) explains the hooks that express those obligations. A legal instruction sequence can still violate the ABI if it passes or preserves values incorrectly.

Some operations lower to runtime calls. Inspect [libgcc helpers](libgcc/libgcc2.c) when assembly contains a compiler support symbol instead of the expected instruction. Distinguish libgcc from [glibc runtime loading](repo:bminor/glibc/elf/rtld.c), and both from [the C++ vector implementation](libstdc++-v3/include/bits/stl_vector.h). Compiler-generated helpers, operating-system C library services, and language-library templates serve different roles.

A RISC-V experiment requires a compiler configured with that target and suitable tools. A native x86 compiler does not become a RISC-V compiler by adding a target option copied from another toolchain.

---
id: ch8
title: Chapter 8 — Turn a Compiler Hypothesis into a Regression Test
fileRecommendations:
  readingOrder:
    - path: gcc/doc/sourcebuild.texi
      description: Source layout and testsuite conventions
      type: docs
    - path: gcc/testsuite/lib/gcc-dg.exp
      description: DejaGNU support for GCC directive-based tests
      type: source
    - path: gcc/testsuite/gcc.dg/tree-ssa/
      description: Focused tests for tree and SSA transformations
      type: directory
    - path: gcc/testsuite/gcc.target/riscv/
      description: Target-specific regression cases
      type: directory
    - path: contrib/check_GNU_style.py
      description: Contribution style checks
      type: source
---

A compiler bug report needs an input, an invocation, a target, and an observable failure. Reduce the program while preserving the issue. First establish that the source has defined behavior for the claimed result; an optimization exposing undefined behavior is different from a miscompilation of a valid program.

Read [the testing conventions](gcc/doc/sourcebuild.texi) and [the directive harness](gcc/testsuite/lib/gcc-dg.exp). Then select a nearby case in [the tree-SSA tests](gcc/testsuite/gcc.dg/tree-ssa/) or [the RISC-V target tests](gcc/testsuite/gcc.target/riscv/). Distinguish compile-only, execution, diagnostic, dump-scanning, and assembly-scanning tests. Choose the assertion that demonstrates the bug without tying it to unrelated output.

For a pass change, compare the relevant dump before and after the patch, then run the focused tests under the configured testsuite. Widen testing to the affected language and target, following [the build and testing instructions](gcc/doc/install.texi). [Style checks](contrib/check_GNU_style.py) help prepare a patch, but they do not establish optimization correctness.

Complete the reading route by explaining one function end to end: driver command, front-end construct, GIMPLE statements, SSA transformation, RTL expansion, target pattern, and regression test. Use [LLVM's code-generator guide](repo:llvm/llvm-project/llvm/docs/CodeGenerator.rst) as a second architecture to compare. The useful comparison is where each compiler enforces an invariant, rather than whether two similarly named files perform identical work.
