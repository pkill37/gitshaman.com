---
curatedRepoId: typescript-go-7.0.2
owner: microsoft
repo: typescript-go
revision: 2bd066d87f5bafd315be9f40889d0a60b9e58e0b
guideId: typescript-compiler-guide
name: TypeScript Compiler In The Mind
description: Understanding TypeScript Before Code
defaultOpenIds:
  - ch1
  - ch2
  - ch3
  - ch4
  - ch5
  - ch6
---

# TypeScript Compiler In The Mind

## Understanding TypeScript Before Code

> This is not a guide to writing TypeScript. This guide explains the
> TypeScript 7 native compiler and language tooling implementation.

TypeScript 7 moves the compiler and language tooling onto a native Go foundation. The implementation
keeps the familiar TypeScript compiler concepts: source files, syntax trees, symbols, types, programs,
module resolution, emit, project references, watch mode, and language service features. The important
change is the implementation substrate, not the basic compiler questions.

Read this repository as a pipeline: command-line entry points gather options, the compiler builds a
program from files and configuration, the scanner and parser produce ASTs, the binder creates symbols,
the checker resolves types and diagnostics, and the printer and transformers emit JavaScript and
declarations.

---
id: ch1
title: Chapter 1 - Source Tree Mental Model
fileRecommendations:
  readingOrder:
    - path: README.md
      description: Project status, TypeScript 7 context, and feature coverage
      type: docs
    - path: CHANGES.md
      description: Intentional behavior differences from the previous compiler
      type: docs
    - path: CONTRIBUTING.md
      description: Build, test, generation, and contribution workflow
      type: docs
    - path: cmd/tsgo/main.go
      description: Native compiler command entry point
      type: source
    - path: internal/
      description: Contains compiler, language service, project, module, and tooling packages.
      type: directory
    - path: testdata/
      description: Contains ported and native test inputs.
      type: directory
    - path: _submodules/
      description: Contains linked upstream TypeScript repository content used during the port.
      type: directory
---

### The Repository Is The Native Compiler

The center of the tree is `internal/`. It contains compiler phases, compiler services, module
resolution, diagnostics, virtual file-system abstractions, project graph support, the language server,
formatting, and testing helpers. The command in `cmd/tsgo` is thin by design: it selects a mode and
hands work to internal packages.

The `README.md` states the TypeScript 7 context and feature status. Treat it as release context, then
move into `internal/compiler`, `internal/parser`, `internal/binder`, and `internal/checker`.

```chapter-graph
cmd/tsgo/main.go -> internal/execute/tsc.go : dispatches command-line execution
internal/execute/tsc.go -> internal/compiler/program.go : creates programs from options and files
internal/compiler/program.go -> internal/parser/parser.go : obtains parsed source files
internal/compiler/program.go -> internal/checker/checker.go : asks for semantic diagnostics and types
```

### Read Around The Compatibility Goal

TypeScript 7 is a port, not a redesign from first principles. Package and function names often mirror
the older compiler's architecture. When a file looks faithful to the old implementation,
that often reflects the need to preserve compatibility.

---
id: ch2
title: Chapter 2 - Command Line And Program Creation
fileRecommendations:
  readingOrder:
    - path: cmd/tsgo/main.go
      description: CLI process entry and mode selection
      type: source
    - path: internal/execute/
      description: Contains command-line execution, status handling, and compiler invocation.
      type: directory
    - path: internal/compiler/program.go
      description: Program lifecycle, source files, project references, and diagnostics
      type: source
    - path: internal/compiler/host.go
      description: Compiler host abstraction over files, paths, and libraries
      type: source
    - path: internal/tsoptions/
      description: Contains command-line and tsconfig option parsing.
      type: directory
    - path: internal/vfs/
      description: Contains virtual file-system interfaces.
      type: directory
    - path: internal/tspath/
      description: Contains TypeScript path normalization and comparison helpers.
      type: directory
---

### Programs Are The Unit Of Compilation

The compiler does not type-check isolated text. It builds a `Program`: a set of source files,
compiler options, library files, resolved modules, project-reference state, diagnostics, and caches.
Most later phases are questions asked of that program.

[internal/compiler/program.go](internal/compiler/program.go) is the central file. It imports parser,
scanner, binder, checker, module resolution, option parsing, package JSON support, source maps, and
path utilities because program creation is where all those concerns meet.

```chapter-graph
cmd/tsgo/main.go -> internal/execute/tsc.go : passes process arguments into execution
internal/execute/tsc.go -> internal/tsoptions/commandlineparser.go : parses flags and config options
internal/execute/tsc.go -> internal/compiler/program.go : creates a compiler program
internal/compiler/program.go -> internal/compiler/host.go : reads files through host abstractions
internal/compiler/program.go -> internal/module/resolver.go : resolves imports and package boundaries
```

### The Host Boundary Matters

The compiler host is what lets the same compiler run against the real OS, test file systems, editor
state, and project-service caches. When debugging "why was this file in the program?", follow the path
from command-line options into the host, then into module resolution and processed files.

---
id: ch3
title: Chapter 3 - Scanner Parser And AST
fileRecommendations:
  readingOrder:
    - path: internal/scanner/
      description: Contains tokenization and lexical diagnostics.
      type: directory
    - path: internal/parser/parser.go
      description: Parser implementation for TypeScript and JavaScript syntax
      type: source
    - path: internal/parser/jsdoc.go
      description: JSDoc parsing support
      type: source
    - path: internal/ast/ast.go
      description: AST node types and source-file representation
      type: source
    - path: internal/astnav/
      description: Contains AST traversal helpers.
      type: directory
    - path: internal/diagnostics/
      description: Contains diagnostic message definitions and identifiers.
      type: directory
---

### Syntax Is Preserved For Tooling

TypeScript's parser is not only feeding an optimizer. It supports diagnostics, declaration emit,
formatting, language service navigation, quick info, refactors, and source maps. That is why AST nodes
carry source positions and why parser behavior must remain compatible with the established compiler.

```chapter-graph
internal/scanner/scanner.go -> internal/parser/parser.go : tokens drive recursive-descent parsing
internal/parser/parser.go -> internal/ast/ast.go : parser allocates AST nodes
internal/parser/jsdoc.go -> internal/ast/ast.go : JSDoc contributes syntax-linked metadata
internal/astnav/tokens.go -> internal/ast/ast.go : traversal utilities inspect parsed trees
internal/diagnostics/diagnostics_generated.go -> internal/parser/parser.go : parser reports syntax diagnostics
```

### Start With SourceFile

Open [internal/ast/ast.go](internal/ast/ast.go) and find the source-file type before reading parser
details. Then read parser functions by syntax category: declarations, statements, expressions, types,
and JSDoc. This gives structure to a large recursive-descent parser.

---
id: ch4
title: Chapter 4 - Binding And Type Checking
fileRecommendations:
  readingOrder:
    - path: internal/binder/
      description: Contains symbol creation, scopes, and declaration binding.
      type: directory
    - path: internal/checker/checker.go
      description: Main type checker implementation
      type: source
    - path: internal/checker/types.go
      description: Type structures used by the checker
      type: source
    - path: internal/checker/symbols.go
      description: Symbol utilities and checker-facing symbol behavior
      type: source
    - path: internal/nodebuilder/
      description: Builds type nodes for display and declaration output.
      type: directory
    - path: internal/evaluator/
      description: Contains constant and expression evaluation support.
      type: directory
---

### Binding Gives Names A Shape

Parsing tells the compiler what the text says. Binding tells it what names exist and where they live:
source files, modules, classes, functions, blocks, imports, exports, and merged declarations. The type
checker depends on that symbol graph.

```chapter-graph
internal/parser/parser.go -> internal/binder/binder.go : parsed declarations are bound to symbols
internal/binder/binder.go -> internal/checker/checker.go : checker consumes bound symbols and scopes
internal/checker/checker.go -> internal/checker/types.go : type relationships use checker type data
internal/checker/checker.go -> internal/nodebuilder/nodebuilder.go : type display builds syntax nodes
internal/evaluator/evaluator.go -> internal/checker/checker.go : constant evaluation supports checking
```

### The Checker Is The Largest Surface

[internal/checker/checker.go](internal/checker/checker.go) is intentionally large because TypeScript's
type system is a large semantic engine. Do not read it linearly. Follow one diagnostic or language
feature at a time: assignability, narrowing, inference, overload resolution, indexed access, mapped
types, conditional types, JSX, or declaration emit support.

---
id: ch5
title: Chapter 5 - Module Resolution Projects And Incrementality
fileRecommendations:
  readingOrder:
    - path: internal/module/
      description: Contains module resolution implementation.
      type: directory
    - path: internal/packagejson/
      description: Contains package.json parsing and package boundary metadata.
      type: directory
    - path: internal/project/
      description: Contains project service and configured/inferred project behavior.
      type: directory
    - path: internal/fswatch/
      description: Contains file watching support.
      type: directory
    - path: internal/compiler/program.go
      description: Program update and project-reference handling
      type: source
    - path: internal/outputpaths/
      description: Contains output path computation for emit and declaration files.
      type: directory
    - path: internal/symlinks/
      description: Contains symlink tracking used by module and package resolution.
      type: directory
---

### TypeScript Is A Project Graph Tool

The compiler spends a lot of effort deciding which files exist in a compilation and how import strings
become source files or declarations. Config files, project references, package boundaries,
`node_modules`, symlinks, generated declaration outputs, watch updates, and editor state all affect the
program graph.

```chapter-graph
internal/tsoptions/tsconfigparsing.go -> internal/project/project.go : config files define projects
internal/project/project.go -> internal/compiler/program.go : projects create and update programs
internal/compiler/program.go -> internal/module/resolver.go : programs resolve imports
internal/module/resolver.go -> internal/packagejson/packagejson.go : package metadata guides resolution
internal/project/project.go -> internal/fswatch/watcher.go : watch mode observes project inputs
```

### Incremental Correctness Is A Cache Problem

Fast recompilation depends on reusing parsed files, resolution results, diagnostics, and checker state
without accepting stale answers. When reading incremental code, look for the invalidation condition:
what changed, what can be reused, and what forces a new program?

---
id: ch6
title: Chapter 6 - Emit Language Service And Tests
fileRecommendations:
  readingOrder:
    - path: internal/transformers/
      description: Contains JavaScript and declaration transform pipeline.
      type: directory
    - path: internal/printer/
      description: Contains source text printing.
      type: directory
    - path: internal/sourcemap/
      description: Contains source map generation.
      type: directory
    - path: internal/ls/
      description: Contains language service features.
      type: directory
    - path: internal/lsp/
      description: Contains Language Server Protocol implementation.
      type: directory
    - path: internal/format/
      description: Contains formatting implementation.
      type: directory
    - path: internal/fourslash/
      description: Contains editor-service test framework.
      type: directory
    - path: internal/testrunner/
      description: Contains test harness and compiler test execution.
      type: directory
---

### Type Checking Is Not The End

After checking, TypeScript still needs to produce JavaScript, declarations, source maps, diagnostics,
editor features, formatting edits, completions, quick info, navigation, and LSP responses. These
features reuse the same AST, symbol, type, module, and project machinery.

```chapter-graph
internal/checker/checker.go -> internal/transformers/transformer.go : semantic information guides emit
internal/transformers/transformer.go -> internal/printer/printer.go : transformed trees become text
internal/printer/printer.go -> internal/sourcemap/generator.go : printed output records mappings
internal/project/project.go -> internal/ls/languageservice.go : project state feeds editor features
internal/lsp/server.go -> internal/ls/languageservice.go : LSP exposes language service operations
internal/fourslash/fourslash.go -> internal/ls/languageservice.go : tests exercise editor behavior
```

### Tests Are A Compatibility Map

Use tests to learn the compatibility surface. Compiler tests explain diagnostics and emit expectations;
fourslash tests explain editor behavior; project tests explain watch and configuration behavior. For a
port like TypeScript 7, tests serve as more than safeguards. They are a catalog of observable behavior that
the native implementation must preserve.
