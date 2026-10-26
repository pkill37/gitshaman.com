---
curatedRepoId: zephyr-v3.7.0
owner: zephyrproject-rtos
repo: zephyr
revision: v3.7.0
guideId: zephyr-rtos-guide
name: Zephyr In The Mind
description: Understanding how configuration, devices, and threads become an embedded system
defaultOpenIds:
  - ch1
  - ch2
  - ch3
  - ch4
  - ch5
  - ch6
---

# Zephyr In The Mind

Zephyr combines a real-time kernel with a hardware model, drivers, networking, and build tooling. This guide targets **v3.7.0**, the baseline of the 3.7 LTS series. The central question is how a chosen board and application become one configured firmware image with explicit execution and ownership rules.

---
id: ch1
title: Chapter 1 — The Build Defines the System
fileRecommendations:
  readingOrder:
    - path: README.rst
      description: Project scope and documentation entry points
      type: docs
    - path: west.yml
      description: External module revisions in the workspace manifest
      type: source
    - path: Kconfig
      description: Root of the software configuration tree
      type: source
    - path: samples/hello_world/src/main.c
      description: Minimal application entry point
      type: source
    - path: samples/hello_world/CMakeLists.txt
      description: Application integration with the Zephyr build
      type: source
    - path: doc/build/kconfig/setting.rst
      description: Configuration inputs and their merge rules
      type: docs
    - path: doc/build/dts/howtos.rst
      description: Devicetree inspection and overlay workflow
      type: docs
---

A Zephyr application selects software features through Kconfig and describes hardware through devicetree. CMake combines application sources, enabled kernel features, drivers, and architecture support into an image. The `west` tool manages a workspace whose external projects are pinned in [the manifest](west.yml); the Zephyr repository is the central tree, not the entire workspace.

Start with [hello world's application](samples/hello_world/src/main.c) and [its build definition](samples/hello_world/CMakeLists.txt). The small application body depends on generated configuration. Read [the root Kconfig](Kconfig) to distinguish a feature being compiled into the image from an application calling it at runtime.

Keep three inputs separate: application policy, board hardware description, and software feature selection. A source file alone cannot tell which driver instances or kernel options a particular image contains.

The application's configuration file requests Kconfig values; [hello world's configuration](samples/hello_world/prj.conf) leaves these requests empty. Board defaults, dependencies, and other configuration fragments contribute to the resolved result. Devicetree starts from board and SoC descriptions, with application overlays modifying the hardware description. Bindings describe node properties and supply information used to generate devicetree macros. An overlay does not replace the driver's software configuration.

After configuring an image, inspect these build outputs, which are generated artifacts rather than tracked repository sources:

```text
build/zephyr/.config       resolved Kconfig values
build/zephyr/zephyr.dts    merged devicetree
```

Compare the requested feature with its resolved Kconfig value, then inspect the peripheral's node status and properties in the merged tree. Follow [the Kconfig merge rules](doc/build/kconfig/setting.rst) and [devicetree inspection workflow](doc/build/dts/howtos.rst) when the resulting image differs from the application inputs.

---
id: ch2
title: Chapter 2 — Devices Exist Before Application Logic
fileRecommendations:
  readingOrder:
    - path: kernel/init.c:z_cstart
      description: Kernel startup, initialization levels, and main-thread entry
      type: source
    - path: include/zephyr/init.h
      description: Registration of ordered initialization functions
      type: source
    - path: include/zephyr/device.h
      description: Device objects, initialization, and readiness checks
      type: source
    - path: samples/basic/blinky/src/main.c
      description: Devicetree-selected GPIO use in an application
      type: source
    - path: boards/nordic/nrf52840dk/nrf52840dk_nrf52840.dts
      description: Concrete board aliases and GPIO-connected LEDs
      type: source
    - path: dts/bindings/gpio/nordic,nrf-gpio.yaml
      description: Binding for the Nordic GPIO controller
      type: docs
    - path: drivers/gpio/gpio_nrfx.c:GPIO_NRF_DEVICE
      description: GPIO device instantiation with configuration, state, and API pointers
      type: source
---

Enabled devicetree nodes supply hardware information, but they do not create device objects on their own. Compiled driver code must instantiate those objects through device-definition macros. A device object connects an API implementation with instance configuration and runtime state. Initialization levels and priorities determine when setup code runs; the presence of a node does not guarantee that a driver was built or that initialization succeeded.

Trace [kernel startup](kernel/init.c) through the initialization machinery in [the init interface](include/zephyr/init.h). Pre-kernel initialization runs before normal thread services are available. Later initialization can rely on more kernel infrastructure, but still has ordering constraints.

Then read [blinky](samples/basic/blinky/src/main.c). It obtains GPIO information from devicetree, checks device readiness, and configures the pin before using it. That trace connects the board's hardware description to a driver-backed operation without hard-coding a peripheral address in application logic.

Use the [nRF52840 DK board description](boards/nordic/nrf52840dk/nrf52840dk_nrf52840.dts) as a concrete example. Its `led0` alias identifies an LED node whose `gpios` property refers to a GPIO controller, pin, and flags. `GPIO_DT_SPEC_GET` in blinky constructs a specification containing that controller's device pointer. The LED child node is not itself the GPIO controller device.

Follow the controller's compatible string to [its binding](dts/bindings/gpio/nordic,nrf-gpio.yaml), then inspect [`GPIO_NRF_DEVICE`](drivers/gpio/gpio_nrfx.c:GPIO_NRF_DEVICE). The driver expands `DT_INST_FOREACH_STATUS_OKAY`, supplies per-instance configuration and state, and calls `DEVICE_DT_INST_DEFINE` with an initialization function and API table. With this driver enabled, GPIO configuration dispatches through that table to [`gpio_nrfx_pin_configure()`](drivers/gpio/gpio_nrfx.c:gpio_nrfx_pin_configure).

A missing alias or property can fail preprocessing or compilation. A referenced device with no compiled definition can fail linking. A defined device whose initialization fails requires a runtime readiness check. `gpio_is_ready_dt()` addresses that last case, not the first two.

---
id: ch3
title: Chapter 3 — Threads Compete by Priority and Eligibility
fileRecommendations:
  readingOrder:
    - path: kernel/thread.c
      description: Thread setup and lifecycle
      type: source
    - path: kernel/sched.c
      description: Ready queues, scheduling, and wakeup decisions
      type: source
    - path: kernel/timeout.c
      description: Timeout bookkeeping and expiration
      type: source
    - path: include/zephyr/kernel/thread.h
      description: Thread state and scheduling data structures
      type: source
    - path: doc/kernel/services/scheduling/index.rst
      description: Yielding, sleeping, and time-slicing rules
      type: docs
    - path: doc/kernel/services/threads/index.rst
      description: Thread priorities and the meta-IRQ exception
      type: docs
---

A thread combines a stack, scheduling state, and an entry function. Blocking removes it from the set of eligible threads until an event or timeout wakes it. Follow [thread setup](kernel/thread.c), then inspect [scheduler decisions](kernel/sched.c) rather than assuming every wakeup causes an immediate switch.

Lower numerical thread priorities mean higher priority in Zephyr. Negative priorities describe cooperative threads; nonnegative priorities describe preemptible threads. A cooperative thread keeps execution until it blocks or yields under the normal scheduling rules. Interrupts still run, and configured meta-IRQ threads introduce another preemption rule.

[`k_yield()`](kernel/sched.c:z_impl_k_yield) leaves the caller ready and moves it behind eligible peers at its priority. If no equal- or higher-priority thread is ready, the caller resumes; yielding in a busy loop does not give lower-priority work a turn. Blocking on an event or sleeping removes that eligibility. Read [the scheduling rules](doc/kernel/services/scheduling/index.rst) with this distinction in mind.

When `CONFIG_NUM_METAIRQ_PRIORITIES` enables [meta-IRQ threads](doc/kernel/services/threads/index.rst), these occupy the highest-priority part of the cooperative range. They can preempt lower-priority cooperative threads and threads holding a scheduler lock. They still run on thread stacks and remain interruptible by hardware IRQs. Use this as an explicit exception to cooperative execution, not as a synonym for an ordinary high-priority thread.

Time slicing applies according to configuration and thread eligibility. SMP adds CPU eligibility and concurrent execution. Establish those options before making claims about fairness or response time. [Timeout processing](kernel/timeout.c) determines when a wait expires; the scheduler determines when the released thread executes.

---
id: ch4
title: Chapter 4 — Interrupts, Work Queues, and Ownership
fileRecommendations:
  readingOrder:
    - path: kernel/work.c
      description: Work submission and worker-thread execution
      type: source
    - path: kernel/msg_q.c
      description: Bounded message copying and waiter management
      type: source
    - path: kernel/sem.c
      description: Semaphore signaling and blocking
      type: source
    - path: kernel/mutex.c
      description: Mutex ownership and priority inheritance
      type: source
    - path: doc/kernel/services/interrupts.rst
      description: Ordinary ISR contracts and zero-latency interrupt restrictions
      type: docs
---

An ISR handles the time-sensitive hardware boundary and hands longer work to a thread. Check each API's ISR contract: operations that would wait must not block an interrupt handler. A semaphore can signal an event, while a message queue transfers fixed-size data and preserves a sequence up to its capacity.

For an ordinary ISR, `k_msgq_put(&events, &event, K_NO_WAIT)` copies an event or returns an error without waiting for space. Check that result and apply an overload policy. A timeout of zero is necessary for this API in ISR context, but it does not make every kernel API ISR-safe.

The [interrupt documentation](doc/kernel/services/interrupts.rst) defines a separate **zero-latency** class on supported architectures, enabled through `CONFIG_ZERO_LATENCY_IRQS` and `IRQ_ZERO_LATENCY`. Those interrupts bypass normal interrupt locking and must treat kernel API use as undefined behavior. They must not manipulate data inspected by kernel APIs in normal contexts. Keep hardware-only handling there and design any handoff through an architecture-appropriate boundary; do not call the message-queue API from that context.

A [work queue](kernel/work.c) executes submitted handlers in a worker thread. This gives handlers thread context, but a slow handler delays later work on the same queue. Resubmitting a work item is not a substitute for storing every event; use an explicit message buffer when each sample matters.

Mutexes protect ownership among threads and provide priority inheritance. Compare [mutex handling](kernel/mutex.c) with [semaphore handling](kernel/sem.c): a semaphore has no mutex-style owner to inherit a waiter's priority. Track both buffer lifetime and synchronization when moving data from a driver to application code.

---
id: ch5
title: Chapter 5 — Memory Protection Is a Configuration Choice
fileRecommendations:
  readingOrder:
    - path: kernel/mem_slab.c
      description: Fixed-size allocation with bounded block inventory
      type: source
    - path: kernel/mempool.c
      description: Nonwaiting system allocation wrappers such as k_malloc
      type: source
    - path: kernel/kheap.c:k_heap_aligned_alloc
      description: Heap-object allocation, timeout handling, and waiting
      type: source
    - path: kernel/userspace.c
      description: Kernel object permissions and userspace support
      type: source
    - path: kernel/mem_domain.c
      description: Memory-domain partition and thread membership management
      type: source
    - path: kernel/msg_q.c:z_vrfy_k_msgq_put
      description: User-call verification of queue permissions and readable message memory
      type: source
---

Allocation strategy determines both fragmentation behavior and overload policy. [Memory slabs](kernel/mem_slab.c) provide a fixed inventory of equal-sized blocks. For variable-size storage, distinguish two interfaces: [`k_malloc()`](kernel/mempool.c:k_malloc) uses the system heap without waiting and returns `NULL` on allocation failure; [`k_heap_alloc()`](kernel/kheap.c:k_heap_alloc) accepts a heap object and a timeout. Its [allocation path](kernel/kheap.c:k_heap_aligned_alloc) can pend a thread until storage becomes available or the timeout expires. ISR callers must use `K_NO_WAIT`. Waiting is a choice of API and execution context, not a property of all Zephyr allocation.

With userspace enabled on supported hardware, Zephyr can restrict threads through memory domains and kernel object permissions. [Userspace support](kernel/userspace.c) mediates access to kernel objects; [memory domains](kernel/mem_domain.c) organize permitted memory partitions. This is an optional isolation model, not an assumption that every thread is a Linux-style process.

Trace a user thread calling `k_msgq_put`. The generated syscall machinery enters the kernel and reaches [`z_vrfy_k_msgq_put()`](kernel/msg_q.c:z_vrfy_k_msgq_put). `K_SYSCALL_OBJ` checks the queue object, including the caller's permission to use it; `K_SYSCALL_MEMORY_READ` checks that the message buffer is readable for the queue's item size. Successful verification reaches [`z_impl_k_msgq_put()`](kernel/msg_q.c:z_impl_k_msgq_put), the queue implementation. Failed verification triggers the kernel's oops handling rather than returning an ordinary queue-full result. Object permission and accessible memory are separate requirements.

Protection does not establish buffer ownership or deadline bounds. Review stack sizes, shared-memory access, and object permissions alongside the scheduler configuration.

---
id: ch6
title: Chapter 6 — Follow One Hardware Event Through the Image
fileRecommendations:
  readingOrder:
    - path: samples/basic/blinky/src/main.c
      description: Small application-to-device trace
      type: source
    - path: include/zephyr/drivers/gpio.h
      description: GPIO API dispatch and driver contracts
      type: source
    - path: kernel/work.c
      description: Deferred execution boundary for interrupt-driven applications
      type: source
    - path: drivers/gpio/gpio_nrfx.c:nrfx_gpio_handler
      description: Nordic GPIO interrupt callback dispatch
      type: source
    - path: kernel/msg_q.c:z_impl_k_msgq_put
      description: Event copying, direct handoff to a waiting receiver, and queue-full failure
      type: source
    - path: kernel/sched.c:z_ready_thread
      description: Scheduling delay between wakeup and execution
      type: source
---

### Worked Trace — A GPIO Edge Wakes an Output Thread

Blinky demonstrates the output-device path, not interrupt-driven input. For this trace, consider an application on the same nRF52840 DK with a configured button input, an LED output, a message queue of pin-event values, and a preemptible consumer thread waiting in `k_msgq_get(..., K_FOREVER)`. Use ordinary GPIO interrupts and enable the Nordic GPIO interrupt support. Application setup checks devices, configures pins, registers a GPIO callback, and enables edge interrupts; these steps are a proposed application, not behavior already present in blinky.

1. **Hardware and ISR context:** the GPIOTE interrupt enters the Nordic driver stack. Zephyr's [`nrfx_gpio_handler()`](drivers/gpio/gpio_nrfx.c:nrfx_gpio_handler) calls `gpio_fire_callbacks` to invoke the registered application callback. The nrfx HAL below this boundary comes from the workspace module pinned in `west.yml`.
2. **Application callback, still ISR context:** copy the pin-event value with `k_msgq_put(&events, &event, K_NO_WAIT)`. The callback must not wait for space. The copied value has no dependency on the callback's local buffer after the call returns.
3. **Queue implementation within the ISR:** [`z_impl_k_msgq_put()`](kernel/msg_q.c:z_impl_k_msgq_put) locks the queue. If the consumer is waiting, it copies the event into that thread's receive buffer, sets its return value, and calls [`z_ready_thread()`](kernel/sched.c:z_ready_thread). This direct handoff need not consume a ring-buffer slot. Without a waiting receiver, the queue stores the event in its ring buffer if space remains.
4. **Scheduling boundary:** the queue's call to [`z_reschedule()`](kernel/sched.c:z_reschedule) does not turn the callback into thread context. The architecture's interrupt-exit path honors the scheduling decision when it can return to threads. Higher-priority runnable work and interrupt activity can delay the consumer.
5. **Consumer-thread context:** [`z_impl_k_msgq_get()`](kernel/msg_q.c:z_impl_k_msgq_get) completes with the copied event. The application invokes `gpio_pin_toggle_dt` on the LED specification, dispatching through [the GPIO interface](include/zephyr/drivers/gpio.h) to the device driver, then waits again. Unlike the ISR, the thread can perform operations whose contracts permit blocking.

If the queue is full, the nonwaiting put returns `-ENOMSG`. In this example, drop the new event and increment an atomic overflow counter that the consumer can inspect. A button application also needs a debounce policy: a physical press can generate repeated edges. Neither the queue nor the scheduler decides whether those edges represent one logical action.

At each handoff, record who owns the data, which context executes, what can block, and how overflow is handled. Include device initialization and power-state transitions in the model. Measure latency under competing interrupts and thread load rather than treating the RTOS label as a deadline guarantee.

```chapter-graph
drivers/gpio/gpio_nrfx.c -> kernel/msg_q.c : application ISR callback submits a copied event
kernel/msg_q.c -> kernel/sched.c : makes a waiting consumer ready
kernel/sched.c -> include/zephyr/drivers/gpio.h : scheduled application consumer invokes the output API
include/zephyr/drivers/gpio.h -> drivers/gpio/gpio_nrfx.c : dispatches the output operation to the Nordic driver
```
