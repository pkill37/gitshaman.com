---
curatedRepoId: owner-repo-ref
owner: owner
repo: repo
revision: pinned-ref-or-sha
guideId: owner-repo-guide
name: Project Name In The Mind
description: A short, specific learning promise
defaultOpenIds:
  - ch1
---

# Project Name In The Mind

## Understand The System Before Code

> This guide is for building a mental model before diving into implementation detail.

State what the project does, who this guide is for, and what the reader should understand after the
first pass.

---
id: ch1
title: Chapter 1 - Mental Model
difficulty: beginner
learningGoals:
  - Explain the project purpose in one sentence.
  - Identify the first source file worth opening.
trace:
  - path: path/to/entry-file.c
    description: First source entry point
    type: source
fileRecommendations:
  readingOrder:
    - path: path/to/entry-file.c:symbol_name
      description: Before reading, look for the main control flow.
      type: source
    - path: docs/architecture.md
      description: Before reading, look for the subsystem boundaries.
      type: docs
---

### The Mental Model

Explain the concept first. Avoid turning the chapter into a file inventory.

### Where It Lives

Use repository-relative paths. Link important files like [the entry point](path/to/entry-file.c).

```chapter-graph
path/to/entry-file.c -> path/to/helper.c : delegates work
path/to/helper.c -> path/to/public-api.h : uses shared definitions
```
