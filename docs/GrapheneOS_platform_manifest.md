---
curatedRepoId: grapheneos-platform-manifest
owner: GrapheneOS
repo: platform_manifest
revision: 0493b9e3a3ae90faf39bd7979a03df5e5dc63a0a
guideId: grapheneos-platform-manifest-guide
name: GrapheneOS Source In The Mind
description: Understanding GrapheneOS core platform source and its Android manifest
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
---

# GrapheneOS Source In The Mind

GrapheneOS selects AOSP projects and distribution forks, then changes behavior inside those projects. This guide follows one verified example: the per-app exec-spawning switch, from Settings through package-state authorization into application launch. Build, boot, Binder, memory, and policy chapters explain the boundaries that trace crosses.

The pinned manifest uses the Android 17 baseline. Links into the Linux guide use its independently pinned Linux 6.1 source as an interface-reading baseline, not as the kernel shipped on every GrapheneOS device. Select the actual device kernel through the manifest before comparing implementation details. The hosted snapshot contains selected projects at their own locked commits. A full device build also requires the remaining projects and release inputs. Source links below open checkout-relative paths. Manifest links open composition files, and file provenance identifies each selected project's upstream commit.

The editor serves complete eligible text files up to 2 MiB; larger or binary files are omitted. Indexing is separate: symbol extraction reads the first 64 KiB, and text search keeps a shorter prefix, at most 16,384 characters from that input. A visible method late in a large file can be absent from search and definition results. The links in this guide target source methods or pinned lines directly; use upstream provenance for omitted content and full history. Cross-reference results are bounded text matches with heuristic type lookup, not a complete compiler-resolved call graph.

---
id: ch1
title: Chapter 1 — Resolve the Manifest, Then Freeze the Checkout
fileRecommendations:
  readingOrder:
    - path: default.xml
      description: AOSP defaults, GrapheneOS remotes, and project mappings
      type: source
    - path: config.yml
      description: AOSP baseline, distribution revision, added projects, and fork selections
      type: source
    - path: build/make/envsetup.sh:lunch
      description: Release-aware product selection
      type: source
---

The pinned [manifest](default.xml) defaults to the AOSP tag `android-17.0.0_r1`. Its GrapheneOS remotes instead specify branch `17`. Revision selection is project override, then the selected remote's revision, then the manifest default. The GrapheneOS framework fork follows branch `17`, while an unchanged AOSP project such as Blueprint inherits the Android tag. A manifest commit can still refer to moving project branches.

Read [config.yml](config.yml) as source-composition configuration: it declares the AOSP baseline, distribution revision, remotes, added projects, and fork choices. Compare those selections with the XML project entries, including the [hardened allocator project](default.xml:L244). The manifest describes the full distribution; GitShaman hosts a core subset; the search project selector lists those projects, and file provenance identifies their pinned commits.

For a development checkout, prepare a supported Linux host and install Repo using the [GrapheneOS build instructions](https://grapheneos.org/build). In a fresh directory, the branch-oriented workflow is:

```sh
repo init -u https://github.com/GrapheneOS/platform_manifest.git -b 17
repo sync
repo manifest -r -o resolved-manifest.xml
source build/envsetup.sh
lunch --help
```

This captures the checkout obtained at sync time; it does not reproduce GitShaman's existing snapshot. Save the resolved manifest with the product, build-release configuration, variant, host setup, and vendor-input versions. For an official release, follow the project's signed release-tag and manifest-verification procedure instead of substituting this development branch. [Stable release manifests](https://grapheneos.org/build#stable-release-manifest) pin project commits by hash.

In this snapshot, [lunch](build/make/envsetup.sh:lunch) accepts product, release, and variant, and defaults the release to `cur` in its new argument form. Select a documented device target before building. The root-level envsetup path in the command is a manifest-created link into the hosted Make project. A frozen core-project subset is not a complete reproducible device build.

---
id: ch2
title: Chapter 2 — Identify What Builds the Settings Application
fileRecommendations:
  readingOrder:
    - path: packages/apps/Settings/Android.bp:L197
      description: Settings module, platform API access, and privileged installation
      type: source
    - path: build/soong/android/module.go:InitAndroidModule
      description: Soong module infrastructure
      type: source
    - path: build/make/core/product.mk:inherit-product
      description: Product inheritance machinery
      type: source
    - path: build/make/core/main.mk
      description: Make orchestration
      type: source
---

Start with the [Settings module](packages/apps/Settings/Android.bp:L197): its name is `Settings`, it uses platform APIs and declares privileged installation. These declarations describe how the application is built and installed. They do not grant every permission requested by the application and do not independently select it for every product.

Move from that concrete module into [Soong's module infrastructure](build/soong/android/module.go:InitAndroidModule). Then read [product inheritance](build/make/core/product.mk:inherit-product) and [Make orchestration](build/make/core/main.mk) to distinguish module definitions from product package selections. After choosing a valid build target, `m Settings` builds that module and its dependencies; it does not produce or install a complete release image.

The GrapheneOS device and product layer extends these shared mechanisms. Locate its projects in [the full manifest](default.xml) before following a product-specific package decision outside the hosted subset. Do not use [root.bp](build/soong/root.bp) as the module registry: the entire file explains that Soong discovers Blueprint files automatically and that explicit top-level directory lists are obsolete.

For the exec-spawning feature traced later, both the Settings UI and framework implementation are selected GrapheneOS forks. An APK-only change cannot replace framework launch behavior. Record which project owns each edit before choosing the build artifacts needed for a device experiment.

---
id: ch3
title: Chapter 3 — Follow Boot into the GrapheneOS Launch Path
fileRecommendations:
  readingOrder:
    - path: system/core/init/main.cpp:main
      description: Init boot-stage dispatch
      type: source
    - path: system/core/rootdir/init.rc
      description: Zygote configuration import and start trigger
      type: source
    - path: system/core/rootdir/init.zygote64.rc
      description: Concrete 64-bit Zygote service command
      type: source
    - path: frameworks/base/cmds/app_process/app_main.cpp:main
      description: Native entry into the managed runtime
      type: source
    - path: frameworks/base/core/java/com/android/internal/os/ZygoteInit.java:forkSystemServer
      description: System-server fork
      type: source
    - path: frameworks/base/services/java/com/android/server/SystemServer.java:startBootstrapServices
      description: Bootstrap service ordering
      type: source
---

Begin at [init's main](system/core/init/main.cpp:main) and its dispatch into second-stage init. [The root configuration](system/core/rootdir/init.rc) imports a Zygote configuration selected by the device's Zygote property. [The 64-bit service example](system/core/rootdir/init.zygote64.rc) supplies the app-process command and system-server argument; other device configurations can select a different service file.

[app_process](frameworks/base/cmds/app_process/app_main.cpp:main) enters ZygoteInit. Follow [forkSystemServer](frameworks/base/core/java/com/android/internal/os/ZygoteInit.java:forkSystemServer), then [bootstrap service startup](frameworks/base/services/java/com/android/server/SystemServer.java:startBootstrapServices). This fills the native-to-managed gap: init configuration starts a native program, which enters the runtime and starts framework services.

GrapheneOS adds a launch choice beyond the shared startup outline. [ZygoteExtraArgs.create](frameworks/base/core/java/com/android/internal/os/ZygoteExtraArgs.java:create) derives launch flags from app state. [ZygoteConnection's dispatch](frameworks/base/core/java/com/android/internal/os/ZygoteConnection.java:L276) can invoke the native fork-and-exec path. [ExecSpawning](frameworks/base/core/java/com/android/internal/os/ExecSpawning.java:replayCommands) replays recorded setup commands in the fresh process. Keep initial system boot separate from this per-application launch decision.

The exec route has conditions: command replay, invoke-with, and child-Zygote cases affect the branch. Reading the feature name alone does not establish that every Android process uses it. Chapter 8 connects the per-app UI to this exact decision.

### Continue into Linux task creation and executable loading

The [native GrapheneOS launch code](frameworks/base/core/jni/com_android_internal_os_Zygote.cpp:ForkCommon) crosses from the Android runtime into process-creation interfaces. Follow Linux [kernel_clone](repo:torvalds/linux/kernel/fork.c:kernel_clone) to study task creation and sharing, then [do_execveat_common](repo:torvalds/linux/fs/exec.c:do_execveat_common) for replacement of a program image. Fork and exec answer different questions: the former creates a task; the latter replaces its executable image. The GrapheneOS fork-and-exec path needs both concepts.

The Settings switch, per-app policy choices, and parsing of Android init service files belong to the Android projects traced above. Device kernels and GrapheneOS kernel changes can extend the stock baseline, so use these cross-links to identify the generic handoff before opening the manifest-selected kernel.

---
id: ch4
title: Chapter 4 — Trace Package-State Writes through Binder
fileRecommendations:
  readingOrder:
    - path: frameworks/base/core/java/android/app/ContextImpl.java:getSystemService
      description: Context lookup delegates to the service registry
      type: source
    - path: frameworks/base/core/java/android/app/SystemServiceRegistry.java:getSystemService
      description: Manager construction and caching
      type: source
    - path: frameworks/base/core/java/android/content/pm/GosPackageState.java:apply
      description: Client-side package-state submission
      type: source
    - path: frameworks/base/core/java/android/content/pm/IPackageManager.aidl:setGosPackageState
      description: Binder contract for the update
      type: source
    - path: frameworks/base/services/core/java/com/android/server/pm/PackageManagerService.java:setGosPackageState
      description: Server-side entry point
      type: source
    - path: repo:torvalds/linux/drivers/android/binder.c:binder_ioctl_write_read
      description: Kernel-side entry for Binder read/write requests
      type: source
---

Use two distinct routes to understand framework clients. A normal [Context lookup](frameworks/base/core/java/android/app/ContextImpl.java:getSystemService) delegates to [SystemServiceRegistry](frameworks/base/core/java/android/app/SystemServiceRegistry.java:getSystemService), which constructs or retrieves manager objects. That lookup is not itself a universal remote transaction: some work is local, and each manager owns its service interaction.

For a GrapheneOS-specific transaction, start at [GosPackageState.Editor.apply](frameworks/base/core/java/android/content/pm/GosPackageState.java:apply). It calls the package-manager interface obtained through ActivityThread. Match the argument order to [setGosPackageState in AIDL](frameworks/base/core/java/android/content/pm/IPackageManager.aidl:setGosPackageState), then open [the PackageManagerService implementation](frameworks/base/services/core/java/com/android/server/pm/PackageManagerService.java:setGosPackageState). The package name, user ID, updated state, and editor flags cross the boundary.

Authorization is downstream in [GosPackageStatePmHooks.set](frameworks/base/services/core/java/com/android/server/pm/GosPackageStatePmHooks.java:set), rather than in the Settings confirmation dialog. The server obtains caller identity, checks write access, filters the requested changes, and schedules persistence. The editor's success result means the update was applied and scheduled for storage; writeback is asynchronous.

For transport internals, continue into [Java Binder](frameworks/base/core/java/android/os/Binder.java) and [native thread transaction handling](frameworks/native/libs/binder/IPCThreadState.cpp). These explain the machinery supporting the AIDL call, rather than replacing the feature's interface contract and server-side checks.

### Follow a transaction into the Binder driver

Below the AIDL interface, [IPCThreadState.talkWithDriver](frameworks/native/libs/binder/IPCThreadState.cpp:talkWithDriver) issues ioctl with BINDER_WRITE_READ. Match that request to Linux's [Binder ioctl dispatch](repo:torvalds/linux/drivers/android/binder.c:binder_ioctl), then [binder_ioctl_write_read](repo:torvalds/linux/drivers/android/binder.c:binder_ioctl_write_read). Its write processing reaches [binder_transaction](repo:torvalds/linux/drivers/android/binder.c:binder_transaction) for transaction commands. The request and command structures are defined in [the kernel Binder UAPI](repo:torvalds/linux/include/uapi/linux/android/binder.h).

Keep the driver transaction separate from the package-manager operation: the kernel routes Binder work, while PackageManagerService interprets the requested package-state change and applies its authorization rules. From the Linux guide, return through [the Android package-manager contract](frameworks/base/core/java/android/content/pm/IPackageManager.aidl:setGosPackageState) to recover the feature's meaning.

---
id: ch5
title: Chapter 5 — Separate Managed Memory from Allocator Selection
fileRecommendations:
  readingOrder:
    - path: art/runtime/runtime.cc
      description: ART initialization and runtime lifetime
      type: source
    - path: art/runtime/gc/heap.cc
      description: Managed heap configuration
      type: source
    - path: bionic/libc/bionic/malloc_common.cpp
      description: Native allocation dispatch
      type: source
    - path: frameworks/base/core/java/android/ext/settings/app/AswUseHardenedMalloc.java
      description: Per-app hardened allocator selection
      type: source
    - path: frameworks/base/core/java/com/android/internal/os/ZygoteExtraArgs.java:create
      description: Launch flags and allocator compatibility
      type: source
---

A managed object and a native allocation travel through different mechanisms. [ART runtime initialization](art/runtime/runtime.cc) and [heap configuration](art/runtime/gc/heap.cc) explain the managed environment. [Bionic's malloc integration](bionic/libc/bionic/malloc_common.cpp) is an entry point for native allocation dispatch; allocator implementations can live in other projects.

GrapheneOS makes that distinction concrete with [AswUseHardenedMalloc](frameworks/base/core/java/android/ext/settings/app/AswUseHardenedMalloc.java) and the allocator project selected in [the manifest](default.xml:L244). The allocator's implementation is outside this hosted core subset. Follow the selected project's upstream repository when investigating its internals; do not attribute its algorithms to ART's garbage collector.

In [ZygoteExtraArgs.create](frameworks/base/core/java/com/android/internal/os/ZygoteExtraArgs.java:create), allocator selection interacts with launch mode. The code handles a compatibility Zygote path and a flag whose comment describes an environment variable read by the exec-spawned target. [AswUseExecSpawning.isEnabledFor](frameworks/base/core/java/android/ext/settings/app/AswUseExecSpawning.java:isEnabledFor) also contains a native-process exception when the hardened allocator is disabled. This is a reason to read the two settings together rather than treating them as independent switches.

For a memory bug, record the process, allocation layer, effective app-switch values, and launch path. A Settings value alone does not describe the allocator in an already-running process, and a Java object becoming unreachable does not prove immediate release of associated native resources.

### Distinguish allocator memory from Binder mappings

[ProcessState](frameworks/native/libs/binder/ProcessState.cpp) maps the Binder device for its receive-buffer address range. In Linux, [binder_mmap](repo:torvalds/linux/drivers/android/binder.c:binder_mmap) delegates to [binder_alloc_mmap_handler](repo:torvalds/linux/drivers/android/binder_alloc.c:binder_alloc_mmap_handler). This is a driver-managed mapping, not an ART heap allocation and not evidence that glibc malloc participates in Android's Binder path.

For ordinary anonymous address space, compare [Linux mapping construction](repo:torvalds/linux/mm/mmap.c:do_mmap) and [fault handling](repo:torvalds/linux/mm/memory.c:handle_mm_fault). These explain why reserving an address range, populating physical pages, and reclaiming an allocator block are different events. The source of each mmap call matters more than the syscall name alone.

---
id: ch6
title: Chapter 6 — Locate Display and Media Work before Assigning Ownership
fileRecommendations:
  readingOrder:
    - path: frameworks/native/services/surfaceflinger/SurfaceFlinger.cpp
      description: Display composition service
      type: source
    - path: frameworks/av/media/libmediaplayerservice/MediaPlayerService.cpp
      description: Playback-service client creation
      type: source
    - path: frameworks/base/core/java/android/view/SurfaceControl.java
      description: Framework surface-control boundary
      type: source
---

Display composition and media playback are separate service investigations. Open [SurfaceFlinger](frameworks/native/services/surfaceflinger/SurfaceFlinger.cpp) for layers and display composition, and [SurfaceControl](frameworks/base/core/java/android/view/SurfaceControl.java) for a framework-facing surface boundary. A layer or surface operation is not a description of the complete graphics driver.

For playback, inspect [MediaPlayerService](frameworks/av/media/libmediaplayerservice/MediaPlayerService.cpp) and find its client creation and player implementation selection. Record the caller's process and the service handling the request before following codecs or hardware. The hosted framework, native, and AV projects cover platform responsibilities; device-specific graphics and media components still need their manifest-selected sources.

In GrapheneOS, a project being forked does not establish that a particular rendering or playback path has changed. To investigate a claimed distribution difference, choose a method, compare its pinned implementation with the corresponding [LineageOS native service](repo:LineageOS/android/frameworks/native/services/surfaceflinger/SurfaceFlinger.cpp), and separate baseline changes from local modifications. Record a concrete changed check or call rather than inferring one from the repository owner.

This ownership discipline also limits the exec-spawning case study: its application launch behavior does not, by itself, explain a GPU-driver fault or codec result. Extend the trace only when source evidence connects those components.

---
id: ch7
title: Chapter 7 — Distinguish App-Switch Authorization from SELinux Policy
fileRecommendations:
  readingOrder:
    - path: frameworks/base/services/core/java/com/android/server/pm/GosPackageStatePermissions.java
      description: Caller and package-state access policy
      type: source
    - path: frameworks/base/services/core/java/com/android/server/pm/GosPackageStatePmHooks.java:set
      description: Write filtering and persistence
      type: source
    - path: frameworks/base/core/java/com/android/internal/os/SELinuxFlags.java
      description: GrapheneOS app policy flag selection
      type: source
    - path: system/sepolicy/private/app.te
      description: Platform application-domain rules
      type: source
    - path: system/sepolicy/public/te_macros
      description: SELinux policy macros
      type: source
    - path: repo:torvalds/linux/security/selinux/hooks.c:selinux_binder_transaction
      description: SELinux hook for Binder transaction authorization
      type: source
---

The package-state transaction from chapter 4 has an authorization policy of its own. [GosPackageStatePermissions](frameworks/base/services/core/java/com/android/server/pm/GosPackageStatePermissions.java) describes which state access the caller receives. In [the write hook](frameworks/base/services/core/java/com/android/server/pm/GosPackageStatePmHooks.java:set), no write permission means failure; an allowed write is still filtered before the per-user package state is updated. Shared-UID handling is visible in the same method.

These checks are separate from Android runtime permissions managed by [PermissionService](frameworks/base/services/permission/java/com/android/server/permission/access/permission/PermissionService.kt). They are also separate from SELinux access decisions. A package-state flag, a runtime permission grant, and a policy allow rule represent different facts.

[SELinuxFlags](frameworks/base/core/java/com/android/internal/os/SELinuxFlags.java) connects GrapheneOS app configuration to policy-related launch flags. Read it beside [application policy](system/sepolicy/private/app.te) and expand unfamiliar constructs with [the macro definitions](system/sepolicy/public/te_macros). The final device policy includes inputs beyond this platform-only snapshot.

For the exec-spawning example, identify the caller allowed to edit package state, the effective setting used at launch, and the resulting process path. Do not replace that trace with a claim that the Settings warning enforces authorization or that a launch flag proves a complete security guarantee.

### Compare framework authorization with kernel SELinux checks

The Linux Binder driver invokes a security hook during a transaction. Inspect [selinux_binder_transaction](repo:torvalds/linux/security/selinux/hooks.c:selinux_binder_transaction), then [avc_has_perm](repo:torvalds/linux/security/selinux/avc.c:avc_has_perm) for the access-vector-cache permission path. Compare that kernel decision with [GrapheneOS's package-state permission filter](frameworks/base/services/core/java/com/android/server/pm/GosPackageStatePermissions.java). Passing a Binder-domain check does not grant permission to edit every package-state flag; the framework still evaluates the operation.

The [platform policy macros](system/sepolicy/public/te_macros) provide Android policy inputs, whereas the kernel consumes compiled policy. GrapheneOS's custom per-process SELinux flags can need matching device-kernel changes. Their presence in framework source does not establish support in the stock Linux 6.1 snapshot.

---
id: ch8
title: Chapter 8 — Worked Trace — the Per-App Exec-Spawning Switch
fileRecommendations:
  readingOrder:
    - path: packages/apps/Settings/src/com/android/settings/applications/AppExecSpawning.kt:AppExecSpawningFragment
      description: Feature UI and its app-switch adapter
      type: source
    - path: packages/apps/Settings/src/com/android/settings/applications/AswAppInfoFragment.java:onEntrySelected
      description: Default, on, and off edits with UID restart request
      type: source
    - path: frameworks/base/core/java/android/ext/settings/app/AswUseExecSpawning.java:isEnabledFor
      description: Effective app launch setting
      type: source
    - path: frameworks/base/core/java/com/android/internal/os/ZygoteExtraArgs.java:create
      description: Effective setting becomes launch flags
      type: source
    - path: frameworks/base/core/java/com/android/internal/os/ZygoteConnection.java:L276
      description: Branch into native fork-and-exec
      type: source
---

The concrete feature is the per-app exec-spawning control, not the separate device-wide default. Begin at [AppExecSpawningFragment](packages/apps/Settings/src/com/android/settings/applications/AppExecSpawning.kt:AppExecSpawningFragment). Its adapter returns AswUseExecSpawning. The same file also defines the default-setting controller, so distinguish a per-app override from the default that an app can inherit.

Follow [onEntrySelected](packages/apps/Settings/src/com/android/settings/applications/AswAppInfoFragment.java:onEntrySelected). Default clears the explicit override; on and off write through the app switch into a GosPackageState editor. The fragment requests a UID kill after the edit and calls apply. [The exploit-protection wrapper](packages/apps/Settings/src/com/android/settings/applications/AswExploitProtectionFragment.java:completeStateChange) can show a warning before running the edit. That warning is user interaction; the server-side authorization is the package-manager path from chapters 4 and 7.

The state then crosses [IPackageManager](frameworks/base/core/java/android/content/pm/IPackageManager.aidl:setGosPackageState) into [the write hook](frameworks/base/services/core/java/com/android/server/pm/GosPackageStatePmHooks.java:set). The hook checks and filters access, updates per-user state, and schedules a package-restrictions write. Follow [AswUseExecSpawning](frameworks/base/core/java/android/ext/settings/app/AswUseExecSpawning.java:isEnabledFor) to distinguish the effective value from the raw flag: its default comes from ExtSettings, compatibility mode can force a value, and native processes have a special case.

At launch, [ZygoteExtraArgs.create](frameworks/base/core/java/com/android/internal/os/ZygoteExtraArgs.java:create) negates the effective exec-spawning choice into the USE_ZYGOTE_SPAWNING flag. [ZygoteConnection](frameworks/base/core/java/com/android/internal/os/ZygoteConnection.java:L276) checks that choice and its other launch conditions before calling nativeForkExec. The [native implementation](frameworks/base/core/jni/com_android_internal_os_Zygote.cpp:com_android_internal_os_Zygote_nativeForkExec) prepares the fork-and-exec launch. [Command replay](frameworks/base/core/java/com/android/internal/os/ExecSpawning.java:replayCommands) supplies the process-side continuation. This closes the UI → stored state → authorization → launch-decision route.

```chapter-graph
packages/apps/Settings/src/com/android/settings/applications/AppExecSpawning.kt -> packages/apps/Settings/src/com/android/settings/applications/AswAppInfoFragment.java : per-app control uses shared editing behavior
packages/apps/Settings/src/com/android/settings/applications/AswAppInfoFragment.java -> frameworks/base/core/java/android/content/pm/GosPackageState.java : applies edited state
frameworks/base/core/java/android/content/pm/GosPackageState.java -> frameworks/base/core/java/android/content/pm/IPackageManager.aidl : submits a Binder update
frameworks/base/core/java/android/content/pm/IPackageManager.aidl -> frameworks/base/services/core/java/com/android/server/pm/PackageManagerService.java : server implements the state transaction
frameworks/base/core/java/com/android/internal/os/ZygoteExtraArgs.java -> frameworks/base/core/java/android/ext/settings/app/AswUseExecSpawning.java : reads the effective launch setting
frameworks/base/core/java/com/android/internal/os/ZygoteConnection.java -> frameworks/base/core/jni/com_android_internal_os_Zygote.cpp : dispatches the native fork-and-exec operation
```

To inspect the trace in a development build, compare explicit default, on, and off states for a disposable test app; record compatibility overrides and restart behavior. Inspect the effective launch decision before drawing conclusions from a displayed preference. The code establishes this implementation path, not a measured exploit-resistance result.

---
id: ch9
title: Chapter 9 — Compare Verified Changes at the Same Android Baseline
fileRecommendations:
  readingOrder:
    - path: default.xml
      description: Android baseline and GrapheneOS fork selection
      type: source
    - path: repo:LineageOS/android/default.xml
      description: LineageOS baseline and selected remotes
      type: source
    - path: frameworks/base/core/java/com/android/internal/os/ZygoteConnection.java:L276
      description: GrapheneOS launch decision
      type: source
    - path: repo:LineageOS/android/frameworks/base/packages/SystemUI/src/com/android/keyguard/KeyguardPINView.java:updatePinScrambling
      description: LineageOS PIN-keypad customization
      type: source
---

Both pinned manifests identify `android-17.0.0_r1` as their AOSP baseline, but each forked project has its own locked commit. Compare [GrapheneOS project selection](default.xml) with [LineageOS project selection](repo:LineageOS/android/default.xml) before assuming that identical baseline tags make the fork contents identical.

The exec-spawning case now supplies a specific comparison: GrapheneOS has AswUseExecSpawning, ZygoteExtraArgs, and ExecSpawning in its hosted framework; the corresponding ExecSpawning class is absent from the pinned LineageOS framework snapshot. Compare the [GrapheneOS Zygote connection](frameworks/base/core/java/com/android/internal/os/ZygoteConnection.java:L276) with [LineageOS's version](repo:LineageOS/android/frameworks/base/core/java/com/android/internal/os/ZygoteConnection.java). This establishes a difference in the inspected source, not a complete assessment of either distribution's process security.

For a change in the other direction, follow [LineageOS's PIN-layout implementation](repo:LineageOS/android/frameworks/base/packages/SystemUI/src/com/android/keyguard/KeyguardPINView.java:updatePinScrambling) and its [Settings controller](repo:LineageOS/android/packages/apps/Settings/src/com/android/settings/security/screenlock/PinScramblePreferenceController.java:onPreferenceChange). Its guide traces a UI preference into a provider and SystemUI. That is a different kind of change from replacing an app launch path.

For a review, name the behavior, identify the branch where it changes, and include the app-state or product configuration that enables it. Use the pinned upstream file links for the complete implementation and history. This produces a source-grounded comparison instead of a list of distribution goals.

---
id: ch10
title: Chapter 10 — Follow the AOSP Boot Pipeline from ROM to Zygote
fileRecommendations:
  readingOrder:
    - path: system/core/init/main.cpp:main
      description: Native init entry and first/second-stage dispatch
      type: source
    - path: system/core/init/first_stage_init.cpp
      description: Early mounts and transition to SELinux setup
      type: source
    - path: system/core/init/selinux.cpp:SetupSelinux
      description: Load policy, restore init context, and re-exec init
      type: source
    - path: system/core/rootdir/init.rc
      description: Root init actions and Zygote configuration import
      type: source
    - path: system/core/rootdir/init.zygote64.rc
      description: 64-bit Zygote service declaration
      type: source
    - path: frameworks/base/cmds/app_process/app_main.cpp:main
      description: app_process entry into the managed runtime
      type: source
    - path: frameworks/base/core/java/com/android/internal/os/ZygoteInit.java:main
      description: Zygote preload, socket, and system-server startup
      type: source
---

The AOSP boot path is a sequence of trust decisions and process handoffs. Device vendors choose the ROM and bootloader implementation, while the Android source tree becomes authoritative at the kernel/init boundary. Use AOSP's [bootloader documentation](https://source.android.com/docs/core/architecture/bootloader), [Verified Boot documentation](https://source.android.com/docs/security/features/verifiedboot), and the [init README](https://android.googlesource.com/platform/system/core/+/main/init/README.md) alongside this GrapheneOS source trace:

1. **Boot ROM** is immutable SoC code reached after reset. It initializes enough hardware to find and authenticate the first bootloader. Its keys and fuse configuration form the hardware root of trust and are not part of GrapheneOS or AOSP source.
2. **Bootloaders** initialize DRAM, choose normal/recovery/fastboot mode, load the kernel and device tree, pass boot arguments, and enforce AVB. Modern chains commonly verify `boot` or `init_boot`, `vendor_boot`, `dtbo`, and other chained partitions, including rollback indexes. A locked device rejects an invalid image; an unlocked device can boot with an explicit warning.
3. **Linux** receives control with the kernel, ramdisk, device tree, and command line in memory. It initializes architecture code, memory, drivers, and pseudo-filesystems, then executes ramdisk `/init` as PID 1. Linux creates tasks and enforces kernel security hooks; it does not parse Android service definitions or launch Zygote itself.
4. **First-stage init** mounts `/dev`, `/proc`, `/sys`, and SELinuxfs, reads the first-stage fstab, and mounts the partitions required to find the real system. Dynamic partitions, logical mounts, recovery, and system-as-root change the details, so the product's fstab and boot arguments matter.
5. **SELinux setup and second-stage init** are an explicit re-exec. First-stage init invokes `init selinux_setup`; [`SetupSelinux`](system/core/init/selinux.cpp:SetupSelinux) loads the device's split policy, labels files, restores the init context, and re-execs as `second_stage`. Second-stage init parses `init.rc` imports, sets properties and directories, starts native daemons, mounts `/data`, and executes boot triggers. The device-selected Zygote init configuration imports the ABI-specific service.
6. **Zygote and framework startup** begin when init starts `app_process`. [`ZygoteInit`](frameworks/base/core/java/com/android/internal/os/ZygoteInit.java:main) preloads classes and resources, listens on the Zygote socket, and forks `system_server`. System server starts framework services and SystemUI; application processes are subsequently forked (or, for GrapheneOS's optional launch path, forked and execed) from the Zygote protocol.

Keep four security layers distinct while reading this path: AVB authenticates boot artifacts; Linux credentials and LSM hooks constrain tasks; SELinux domains and types constrain Android processes and objects; Binder and framework permissions govern API access. A process that passed AVB and was forked by Zygote can still receive an SELinux AVC denial or a framework permission denial. The useful diagnostic record is the exact boot mode, image chain, command line, init stage, and AVC source/target/class—not a generic claim that “Android booted securely.”

To reproduce a GrapheneOS boot trace, start with the device's resolved manifest and vendor boot configuration, inspect the selected fstab and Zygote service file, then correlate kernel logs, init timing properties, and system-server startup. The hosted manifest and framework files explain GrapheneOS's userspace handoff and launch modifications; they do not include every vendor bootloader, device kernel, or generated SELinux policy.
