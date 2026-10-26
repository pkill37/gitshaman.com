---
curatedRepoId: freertos-kernel-v11.1.0
owner: FreeRTOS
repo: FreeRTOS-Kernel
revision: V11.1.0
guideId: freertos-kernel-guide
name: FreeRTOS In The Mind
description: Understanding tasks, interrupt handoffs, and timing in a compact embedded kernel
defaultOpenIds:
  - ch1
  - ch2
  - ch3
  - ch4
  - ch5
  - ch6
---

# FreeRTOS In The Mind

FreeRTOS supplies the scheduling and synchronization core of an embedded firmware image. This guide follows **FreeRTOS-Kernel V11.1.0**, rather than the larger collection of FreeRTOS libraries and demos. Read it to understand who owns execution, what makes a task ready, and where timing guarantees need application-level analysis.

---
id: ch1
title: Chapter 1 — A Kernel Inside Your Firmware
fileRecommendations:
  readingOrder:
    - path: README.md
      description: Scope of the kernel repository and its integration model
      type: docs
    - path: include/FreeRTOS.h
      description: Configuration checks and shared kernel definitions
      type: source
    - path: include/task.h
      description: Task creation and scheduler API contracts
      type: source
    - path: tasks.c:vTaskStartScheduler
      description: Transition from application setup into scheduled execution
      type: source
---

The application links the kernel into its firmware and supplies a **FreeRTOSConfig.h** configuration header outside this kernel source tree. No Linux-style process loader sits between an application and the scheduler. Tasks own stacks and scheduling state; on a typical non-MPU port, they share an address space with the kernel.

Start with [the configuration boundary](include/FreeRTOS.h), then trace [scheduler startup](tasks.c:vTaskStartScheduler). Application setup creates initial tasks and communication objects before starting scheduling; tasks can create more objects after startup. In the single-core configuration, the kernel creates an idle task and, when configured, a timer service task. The idle task remains ready at the lowest priority. It runs when no higher-priority task is eligible and can share execution with idle-priority application tasks, subject to scheduling configuration and `configIDLE_SHOULD_YIELD`. It also reclaims kernel storage left by tasks that delete themselves.

Separate three responsibilities: the application defines the workload, the kernel chooses runnable tasks, and the hardware port saves and restores CPU state. A kernel API alone does not establish a deadline guarantee.

---
id: ch2
title: Chapter 2 — Ready Is a Scheduling Decision
fileRecommendations:
  readingOrder:
    - path: tasks.c:TCB_t
      description: Task control blocks, ready lists, delays, and scheduler decisions
      type: source
    - path: list.c
      description: Intrusive lists that organize task state
      type: source
    - path: include/task.h
      description: Priority, delay, suspension, and task notification interfaces
      type: source
    - path: tasks.c:xTaskIncrementTick
      description: Tick accounting and release of delayed tasks
      type: source
    - path: tasks.c:vTaskSwitchContext
      description: Selection of the next task under the configured scheduling policy
      type: source
---

A task is ready when it has no outstanding wait that prevents execution. A blocked task waits for an event or timeout; a suspended task leaves normal scheduling until resumed. Trace those transitions in [task management](tasks.c), using [list operations](list.c) to identify which collection owns a task at each step.

Open [`TCB_t`](tasks.c:TCB_t): its state-list item connects a task to a ready, delayed, or suspended list, while its event-list item can connect it to a queue's waiters. The kernel uses `pxReadyTasksLists` to group ready tasks by priority and two delayed lists to handle tick-counter wraparound. A task waiting on a queue with a timeout can occupy both an event list and a delayed list. Do not mistake those two memberships for two runnable tasks.

In the standard single-core preemptive configuration, the highest-priority ready task runs. Larger FreeRTOS priority numbers mean higher priority. Equal-priority tasks can share tick-driven time slices when time slicing is enabled. Cooperative scheduling and SMP introduce configuration-dependent rules, so establish the selected port and configuration before tracing a switch.

[`vTaskDelay()`](tasks.c:vTaskDelay) measures a relative delay from the call site. [`xTaskDelayUntil()`](tasks.c:xTaskDelayUntil) advances an intended release time, which avoids accumulating the task's execution time into each period. If that release time has passed, the call need not block. Neither form guarantees immediate execution when the delay expires.

Trace [`xTaskIncrementTick()`](tasks.c:xTaskIncrementTick) removing expired entries from the delayed list and adding them to ready lists. Then inspect [`vTaskSwitchContext()`](tasks.c:vTaskSwitchContext), which selects the next task when a switch occurs. Expiring a delay changes eligibility; priority and configuration still determine execution.

---
id: ch3
title: Chapter 3 — Queues Transfer Data, Mutexes Transfer Ownership
fileRecommendations:
  readingOrder:
    - path: queue.c
      description: Queue storage, wait lists, and mutex behavior
      type: source
    - path: include/queue.h
      description: Copy-based message transfer and blocking contracts
      type: source
    - path: include/semphr.h
      description: Semaphore and mutex interfaces layered on queues
      type: source
    - path: tasks.c
      description: Task notification state and priority inheritance support
      type: source
---

A queue copies fixed-size items into kernel-managed storage. Sending a pointer copies the pointer, not the pointed-to object; the application still needs a lifetime and ownership rule. Follow [queue send and receive paths](queue.c) through the full and empty cases to see when a caller blocks and which waiter becomes ready.

Semaphores represent availability or events. Mutexes represent ownership and support priority inheritance: a low-priority holder can inherit the priority of a higher-priority waiter. FreeRTOS uses a simplified inheritance scheme, so nested mutexes deserve a separate timing review. Inheritance reduces one source of priority inversion; it does not bound the holder's work or remove deadlocks.

For a concrete case, let low-priority task L hold mutexes A and B. High-priority task H blocks on B, so L inherits H's priority. When L releases B, H becomes ready, but L still holds A. In the normal release path, [`xTaskPriorityDisinherit()`](tasks.c:xTaskPriorityDisinherit) decrements `uxMutexesHeld` and restores the base priority only when that count reaches zero. L can continue competing at H's priority until it releases A. The timeout path has separate rules in [`vTaskPriorityDisinheritAfterTimeout()`](tasks.c:vTaskPriorityDisinheritAfterTimeout); inheritance is not a complete dependency-graph recomputation.

Task notifications provide per-task signaling without a separate queue object. Choose them when the communication pattern matches their recipient and value semantics. Choose a queue when the receiver needs a sequence of distinct messages.

---
id: ch4
title: Chapter 4 — Interrupts Hand Work to Tasks
fileRecommendations:
  readingOrder:
    - path: portable/GCC/ARM_CM4F/port.c
      description: Cortex-M4F interrupt masking, tick handling, and context switching
      type: source
    - path: portable/GCC/ARM_CM4F/portmacro.h
      description: Port-specific critical sections and ISR yield interface
      type: source
    - path: include/queue.h
      description: ISR-safe queue operations and wakeup reporting
      type: source
---

An interrupt handler cannot wait for a queue slot or mutex. It records an event through an ISR-safe API and lets a task perform work that can block. The `FromISR` interfaces report whether they woke a higher-priority task; the port's ISR yield mechanism requests a scheduling handoff.

Use [the GCC Cortex-M4F port](portable/GCC/ARM_CM4F/port.c) as a concrete example, not a description of every architecture. PendSV performs the context switch, while the tick handler advances kernel time. The port masks a configured range of interrupts around kernel data updates.

On Cortex-M, lower numerical interrupt priority values represent higher urgency, the reverse of FreeRTOS task priorities. Interrupts above the configured syscall urgency boundary must not call kernel APIs, including ISR-safe ones. Trace the priority checks and masking rules before connecting a driver interrupt to a task.

Inspect [`vPortValidateInterruptPriority()`](portable/GCC/ARM_CM4F/port.c:vPortValidateInterruptPriority) with assertions enabled. Distinguish the hardware priority encoding used by `configMAX_SYSCALL_INTERRUPT_PRIORITY` from the unshifted values accepted by CMSIS priority-setting calls. An interrupt's default priority of zero is too urgent for kernel calls on this port. The wake flag passed to queue-send ISR APIs starts at `pdFALSE`; preserve it across operations in the same handler and pass it to `portYIELD_FROM_ISR` before returning.

---
id: ch5
title: Chapter 5 — Timers and Memory Have Execution Costs
fileRecommendations:
  readingOrder:
    - path: timers.c
      description: Timer command queue and timer service task
      type: source
    - path: include/timers.h
      description: Timer callback contracts and zero-wait command examples
      type: source
    - path: portable/MemMang/heap_1.c
      description: Allocation-only policy with no individual frees
      type: source
    - path: portable/MemMang/heap_4.c
      description: Allocator that coalesces adjacent free blocks
      type: source
    - path: portable/MemMang/heap_5.c
      description: Heap allocation across configured memory regions
      type: source
---

Software timer callbacks run in the [timer service task](timers.c), not in a hardware interrupt. Commands reach that task through a queue. **Timer callbacks must not block.** A long callback delays other callbacks and command processing. A callback that waits to submit a command to a full timer queue can deadlock: the same service task must drain that queue to make space. Read the zero-wait examples in [the timer API contract](include/timers.h).

For example, a callback can call `xQueueSend(workQueue, &event, 0)` and check the return value. On success, an application task receives the copied event and performs the lengthy work. On failure, the callback records or applies a defined drop policy without retrying in a blocking loop. This uses the task-context API, not its ISR variant. Timer commands issued from callbacks must also use zero wait.

Memory policy is a separate integration choice. [Heap 1](portable/MemMang/heap_1.c) allocates without reclaiming individual objects; [heap 4](portable/MemMang/heap_4.c) supports frees and coalescing; [heap 5](portable/MemMang/heap_5.c) extends that model across memory regions. Select the implementation that matches the product's object lifetime rules.

Coalescing does not make allocation constant-time. In heap 4, [`pvPortMalloc()`](portable/MemMang/heap_4.c:pvPortMalloc) searches a free-block list while the scheduler is suspended. Fragmentation and list length affect that path; interrupts can still run, but task switching waits for scheduler resumption. Keep allocation out of deadline-sensitive paths or include its cost in the timing model.

Static task and queue creation let the application provide storage. This removes those objects' runtime heap allocation, but stack sizing and buffer ownership still need analysis. Budget stack space for the deepest call path and the port's saved context, then measure high-water marks under representative load.

In this upstream kernel, task stack depths and the values from `uxTaskGetStackHighWaterMark()` use units of `StackType_t`, not bytes. Multiply by `sizeof(StackType_t)` when comparing with a byte budget. The high-water mark reports the least observed unused stack space, not peak used space, and testing cannot prove that an untested path fits.

---
id: ch6
title: Chapter 6 — Trace a Deadline End to End
fileRecommendations:
  readingOrder:
    - path: portable/GCC/ARM_CM4F/port.c
      description: Hardware interrupt and context-switch contribution to latency
      type: source
    - path: queue.c
      description: Event delivery and waiter wakeup
      type: source
    - path: tasks.c
      description: Ready-list selection and delayed-task release
      type: source
---

### Worked Trace — A Sensor Sample Wakes a Control Task

Assume a single-core Cortex-M4F image with preemption enabled, a fixed-size sample queue, and a control task blocked in `xQueueReceive`. The sensor ISR runs at a kernel-call-safe interrupt priority. Hardware acknowledgment and actuator access belong to the application and board port; this kernel repository does not supply those drivers.

1. **ISR context:** acknowledge the sensor interrupt and copy its sample into a local value. Initialize `xHigherPriorityTaskWoken` to `pdFALSE` and call `xQueueSendFromISR(samples, &sample, &xHigherPriorityTaskWoken)`.
2. **Kernel code within the ISR:** the macro reaches [`xQueueGenericSendFromISR()`](queue.c:xQueueGenericSendFromISR). It copies the sample into queue storage and, if a receiver is waiting, calls [`xTaskRemoveFromEventList()`](tasks.c:xTaskRemoveFromEventList). With the scheduler active, that removes the receiver's wait memberships and places it on a ready list. A suspended scheduler defers the ready-list update.
3. **ISR exit:** `portYIELD_FROM_ISR(xHigherPriorityTaskWoken)` requests PendSV when the awakened task outranks the interrupted task. Read [the port yield macro](portable/GCC/ARM_CM4F/portmacro.h:portYIELD_FROM_ISR). Waking a lower-priority task does not force it to run ahead of higher-priority work.
4. **PendSV context:** [`xPortPendSVHandler()`](portable/GCC/ARM_CM4F/port.c:xPortPendSVHandler) saves task context, calls [`vTaskSwitchContext()`](tasks.c:vTaskSwitchContext), and restores the selected task. Other interrupts and critical sections can delay this handoff.
5. **Control-task context:** [`xQueueReceive()`](queue.c:xQueueReceive) resumes, checks the queue, and copies the sample to the task's buffer. The task computes the control output, writes it through the board driver, and waits for another sample. The ISR's local buffer no longer owns the queued copy.

If the queue is full, the ISR send returns `errQUEUE_FULL` without waiting. For this example, drop the new sample and increment an ISR-owned overflow counter; read that counter through a synchronized application interface. Queue capacity absorbs bursts, not sustained overload. A different product might require stopping the actuator or replacing stale data instead, but that choice belongs in its explicit overload policy.

Budget interrupt masking, higher-priority tasks, lock holders, computation, and peripheral transfer time across this trace. Distinguish event-to-task-start latency from event-to-output completion time.

Measure worst observed response under load, then compare it with the assumptions in the timing analysis. A fast average is not a bound. Tickless idle changes how the system sleeps and accounts for elapsed ticks; it does not remove wakeup latency or hardware clock limits.

```chapter-graph
portable/GCC/ARM_CM4F/port.c -> tasks.c : advances ticks and switches task context
queue.c -> tasks.c : wakes tasks waiting for messages
tasks.c -> list.c : maintains ready and delayed task collections
```
