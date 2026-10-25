---
curatedRepoId: lineageos-android
owner: LineageOS
repo: android
revision: 2a50ca061bffe4e73918ae2e0b99b7a05f647154
guideId: lineageos-android-guide
name: LineageOS Source In The Mind
description: Understanding LineageOS core platform source and its Android manifest
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

# LineageOS Source In The Mind

Read LineageOS as a composed Android platform: a manifest selects projects, product configuration selects artifacts, and processes cooperate through framework APIs and native services. This guide follows concrete implementation paths through the manifest-derived core source snapshot.

Use Source for checkout-relative links below and Manifest for project selection. The switch sits at the bottom of the explorer. Each source file exposes its project owner and pinned upstream commit. The coverage disclosure lists the hosted projects; kernels, device trees, prebuilts, and other manifest projects remain outside this reading subset. Search can be restricted to a project. Reference results are text occurrences, with heuristic Java, Kotlin, and AIDL type lookup rather than a complete compiler-resolved call graph. Large files may be truncated in the hosted view; use the upstream link for complete implementations.

Start with setup and the build graph, follow boot into services, then trace one visible Settings feature through IPC and authorization. Compare distributions at the same source entry point after understanding that shared AOSP structure.

---
id: ch1
title: Chapter 1 — From Manifest to a Reproducible Workspace
fileRecommendations:
  readingOrder:
    - path: default.xml
      description: Resolve project paths, remotes, revisions, and included manifests
      type: source
    - path: README.mkdn
      description: Pinned checkout and sync instructions
      type: docs
    - path: build/make/envsetup.sh
      description: Shell entry points for selecting and building a product
      type: source
    - path: build/make/core/product.mk
      description: Product configuration loading and inheritance
      type: source
---

A manifest project has two identities: its remote repository name and its destination path in the checkout. Follow [the manifest](default.xml) from remote definitions to the default revision and then individual projects. An explicit project revision overrides the default; included manifests can add more selections. The branch name alone does not freeze every repository. Record resolved commits when comparing builds.

The pinned [LineageOS README](README.mkdn) initializes Repo with branch lineage-24.0 and Git LFS, then syncs the project set. Follow its [device build instructions](https://wiki.lineageos.org/devices/) for the chosen hardware. Use [AOSP setup](https://source.android.com/docs/setup/start) for shared Repo terminology; preserve the distribution-specific manifest and branch when following it.

For local work, prepare the host using the distribution's build instructions, initialize Repo with the intended release, and sync the complete tree. A Git clone of this manifest does not fetch the operating system. The hosted core snapshot is a reading environment; device support, kernels, toolchains, and proprietary vendor inputs still belong to a full build checkout.

Open [envsetup](build/make/envsetup.sh) to locate `lunch` and `m`, then [product configuration](build/make/core/product.mk) to understand what a selected target inherits. Sourcing envsetup changes the current shell; selecting a product determines the configuration that later build commands consume. Keep the release, device, and build variant together in your notes before diagnosing compilation or runtime behavior.

---
id: ch2
title: Chapter 2 — Build Configuration Becomes Installed Modules
fileRecommendations:
  readingOrder:
    - path: build/soong/README.md
      description: Soong module definitions and build-system concepts
      type: docs
    - path: build/soong/root.bp
      description: Top-level Blueprint configuration
      type: source
    - path: build/make/core/main.mk
      description: Make orchestration for the platform build
      type: source
    - path: packages/apps/Settings/Android.bp
      description: A concrete application module and its dependencies
      type: source
    - path: vendor/lineage/config/common.mk
      description: Distribution product inheritance and package selections
      type: source
---

Android's build graph answers a different question from its manifest. Repo decides which repositories exist; product configuration and module definitions decide which artifacts enter an image. A checked-out application is not automatically installed in every product.

Start with [the Soong overview](build/soong/README.md) and [top-level Blueprint configuration](build/soong/root.bp). Then inspect [Settings' module definition](packages/apps/Settings/Android.bp): identify its module name, source inputs, libraries, resources, and platform integration. Trace any referenced module by name with project-scoped search. Read [Make's main orchestration](build/make/core/main.mk) alongside [product inheritance](build/make/core/product.mk) to see how older Make configuration and Soong coexist.

LineageOS adds another useful layer in [its common product configuration](vendor/lineage/config/common.mk). Follow the inherited configuration and package selections there, then return to the selected module's build definition. [Manifest snippets](snippets/) shape source composition; they are distinct from product makefiles that decide which modules enter a build.

As an exercise, distinguish three facts about Settings: where Repo places its source, which module builds the application, and which product configuration includes it. These are separate edges. When a source change does not affect an image, check product selection and installed-module configuration before assuming the compiler ignored the edit. Build commands and target names vary by release; inspect this snapshot's [envsetup implementation](build/make/envsetup.sh) rather than copying a target from another Android branch.

---
id: ch3
title: Chapter 3 — Boot from Init to Android Applications
fileRecommendations:
  readingOrder:
    - path: system/core/init/main.cpp
      description: Native init entry point and boot-stage dispatch
      type: source
    - path: system/core/init/init.cpp
      description: Second-stage init and event processing
      type: source
    - path: system/core/rootdir/init.rc
      description: Boot actions and imported service configuration
      type: source
    - path: frameworks/base/core/java/com/android/internal/os/ZygoteInit.java
      description: Managed process startup and system-server launch
      type: source
    - path: frameworks/base/services/java/com/android/server/SystemServer.java
      description: Framework service initialization
      type: source
---

Read boot as a sequence of processes gaining responsibilities. Begin at [init's native entry point](system/core/init/main.cpp), follow its stage dispatch into [second-stage init](system/core/init/init.cpp), and connect that execution to [the root init configuration](system/core/rootdir/init.rc). Actions respond to triggers; service declarations describe processes and their execution context. [Service management](system/core/init/service.cpp) and [property handling](system/core/init/property_service.cpp) explain two mechanisms used throughout startup.

Continue with [ZygoteInit](frameworks/base/core/java/com/android/internal/os/ZygoteInit.java), which prepares the managed process environment and starts system server. Then inspect [SystemServer](frameworks/base/services/java/com/android/server/SystemServer.java): search for its bootstrap, core, and other service startup phases. Initialization order matters because later services depend on earlier facilities being available.

For LineageOS, place distribution service additions on this startup spine before investigating their behavior. Product and device configuration can change the set of installed services, so compare an observed device boot against its selected build target rather than assuming every manifest project starts a process.

For an application process, [ActivityThread](frameworks/base/core/java/android/app/ActivityThread.java) is another useful entry point. Follow application binding and the main message loop. Do not treat it as the launcher of every Android process: native daemons, Zygote, system server, and applications have different startup paths. A practical debugging map records the process, the init or framework entry point, and the first dependency that must be ready.

---
id: ch4
title: Chapter 4 — Binder Connects Clients to System Services
fileRecommendations:
  readingOrder:
    - path: frameworks/base/core/java/android/app/ContextImpl.java
      description: Framework client access to system facilities
      type: source
    - path: frameworks/base/core/java/android/os/IBinder.java
      description: Java Binder interface contract
      type: source
    - path: frameworks/base/core/java/android/os/Binder.java
      description: Java Binder endpoint and calling identity
      type: source
    - path: frameworks/native/libs/binder/IPCThreadState.cpp
      description: Native Binder transaction handling
      type: source
    - path: frameworks/native/cmds/servicemanager/main.cpp
      description: Native service-manager startup
      type: source
---

A manager object in an application and the service implementing its requests often live in different processes. Binder supplies the IPC boundary. Start at [ContextImpl](frameworks/base/core/java/android/app/ContextImpl.java), identify a system-service lookup, and distinguish the local API object from the remote service it reaches.

Read [IBinder](frameworks/base/core/java/android/os/IBinder.java) for the low-level Java contract and [Binder](frameworks/base/core/java/android/os/Binder.java) for endpoint behavior and caller identity. In [native transaction handling](frameworks/native/libs/binder/IPCThreadState.cpp), locate transaction submission and dispatch. [ProcessState](frameworks/native/libs/binder/ProcessState.cpp) manages process-wide Binder state, while [service-manager startup](frameworks/native/cmds/servicemanager/main.cpp) introduces the service registry. These files explain different parts of IPC; they are not a single direct call chain.

For LineageOS extensions, establish whether a service belongs to the common Android framework or another project in [the manifest](default.xml). Shared Binder machinery still supplies transport, but the interface contract and permission checks belong to the service being called. An unhosted service needs an upstream source follow-up.

For each service request, write down the client API, interface, server implementation, calling UID, and permission check. Search the interface name across framework and native projects. Generated AIDL glue may be produced during a full build, so a source search does not necessarily expose every intermediate method. Avoid equating a text reference with proof that a call executes: follow the implementation and the process boundary before drawing that conclusion.

---
id: ch5
title: Chapter 5 — ART, Java Libraries, and Native Memory
fileRecommendations:
  readingOrder:
    - path: art/runtime/runtime.cc
      description: ART runtime creation and lifecycle
      type: source
    - path: art/runtime/gc/heap.cc
      description: Managed heap configuration and collection
      type: source
    - path: libcore/ojluni/src/main/java/java/lang/String.java
      description: Core Java library implementation
      type: source
    - path: bionic/libc/bionic/malloc_common.cpp
      description: Native allocation dispatch and integration
      type: source
---

Separate three layers that application code can cross. ART executes managed code and coordinates the managed heap. Libcore supplies Java library implementations. Bionic supplies Android's native C library interface. They work together, but a Java library change, a garbage-collector change, and a native allocator change have different owners and failure modes.

Open [ART's runtime lifecycle](art/runtime/runtime.cc), then [the managed heap](art/runtime/gc/heap.cc). Locate runtime initialization and heap configuration before following collection behavior. Use [String](libcore/ojluni/src/main/java/java/lang/String.java) as a concrete library entry point and inspect where operations rely on runtime support. Move to [Bionic allocation dispatch](bionic/libc/bionic/malloc_common.cpp) to see native allocation integration; dispatch code alone does not describe every allocator backend.

For LineageOS, compare runtime and library behavior only after recording the ART, Libcore, and Bionic revisions selected by [the manifest](default.xml). A difference from another distribution can come from an Android baseline update rather than a LineageOS customization. Keep that distinction explicit in any performance or compatibility hypothesis.

When investigating memory, first identify whether the allocation belongs to the managed heap, native code, or another process. A Java reference disappearing does not imply that all native resources held by an object have been released. For a useful reading exercise, compare the inputs to ART heap configuration with Bionic's allocation entry points and list which subsystem owns each decision. Use pinned upstream links to compare the same files across releases without confusing source selection with measured runtime behavior.

---
id: ch6
title: Chapter 6 — Graphics and Media Have Their Own Service Boundaries
fileRecommendations:
  readingOrder:
    - path: frameworks/native/services/surfaceflinger/SurfaceFlinger.cpp
      description: Display composition service implementation
      type: source
    - path: frameworks/av/media/libmediaplayerservice/MediaPlayerService.cpp
      description: Media playback service implementation
      type: source
    - path: frameworks/base/core/java/android/app/ActivityThread.java
      description: Application lifecycle and process-side execution
      type: source
---

An application does not directly provide the complete display or media stack. Its process participates in a system assembled from framework APIs, IPC, native services, and hardware-specific components. Treat graphics composition and media playback as separate investigations with different buffers, services, and device dependencies.

Open [SurfaceFlinger](frameworks/native/services/surfaceflinger/SurfaceFlinger.cpp), locate its initialization and service-facing methods, and identify the responsibilities around layers and display composition. Then open [MediaPlayerService](frameworks/av/media/libmediaplayerservice/MediaPlayerService.cpp) and follow client creation toward a playback implementation. These entry points introduce the hosted native services; they do not cover every codec, GPU driver, or vendor implementation.

LineageOS device support can supply hardware components beyond these platform entry points. Use [the manifest](default.xml) and the [device build instructions](https://wiki.lineageos.org/devices/) to identify those dependencies. A platform source trace alone does not explain a device-specific display or codec result.

Return to [ActivityThread](frameworks/base/core/java/android/app/ActivityThread.java) to anchor the application's process and lifecycle, then use search to locate the relevant framework API and its native boundary. Record whether a failure occurs in the app, a platform service, or device-specific code. The core snapshot supports the first two parts of that map. Consult the manifest for the remaining project owners before attributing a display or media problem to a distribution patch.

---
id: ch7
title: Chapter 7 — Permissions and SELinux Enforce Different Boundaries
fileRecommendations:
  readingOrder:
    - path: frameworks/base/core/java/android/content/pm/PackageManager.java
      description: Framework package and permission API surface
      type: source
    - path: frameworks/base/services/permission/java/com/android/server/permission/access/permission/PermissionService.kt
      description: Permission-state management implementation
      type: source
    - path: system/sepolicy/private/system_server.te
      description: Platform policy rules for system server
      type: source
    - path: system/sepolicy/private/app.te
      description: Platform application-domain policy
      type: source
    - path: system/sepolicy/public/te_macros
      description: Reusable SELinux policy macros
      type: source
---

Android permission checks and SELinux policy describe different enforcement layers. A granted application permission does not by itself permit every kernel-visible operation. Process identity, service-side checks, and SELinux domains still matter.

Begin with [PackageManager's API](frameworks/base/core/java/android/content/pm/PackageManager.java), then inspect [permission management](frameworks/base/services/permission/java/com/android/server/permission/access/permission/PermissionService.kt). Search for a specific permission name or state transition instead of reading the entire implementation linearly. Follow a caller into the service that performs the protected operation to find the actual enforcement point; permission-state storage is not the only place authorization happens.

Read [system-server policy](system/sepolicy/private/system_server.te) alongside [application-domain policy](system/sepolicy/private/app.te). Expand unfamiliar rules using [the shared policy macros](system/sepolicy/public/te_macros). A macro invocation can encode a relationship that is easy to miss when scanning one policy file.

For LineageOS, compare common platform policy with the policy extensions supplied by the selected device and vendor configuration. [Common product configuration](vendor/lineage/config/common.mk) helps orient the distribution layer; it does not list every runtime authorization check. Keep a framework permission change separate from an SELinux rule change in a review.

For a denied operation, record the calling UID, requested operation, relevant framework check, source and target SELinux contexts, and the rule involved. Device policy extends the platform policy in a full checkout. The hosted subset does not establish the final policy for every device, and a single allow rule does not establish a security guarantee.

---
id: ch8
title: Chapter 8 — Trace a Settings Feature across the Platform
fileRecommendations:
  readingOrder:
    - path: packages/apps/Settings/AndroidManifest.xml
      description: Settings application components and declared permissions
      type: source
    - path: packages/apps/Settings/src/com/android/settings/Settings.java
      description: Settings activity entry classes
      type: source
    - path: packages/apps/Settings/src/com/android/settings/SettingsActivity.java
      description: Activity routing and fragment integration
      type: source
    - path: packages/apps/Settings/Android.bp
      description: Build dependencies for the Settings application
      type: source
---

Use Settings to practice a complete feature trace. Start with [the application manifest](packages/apps/Settings/AndroidManifest.xml): select an activity and identify its exported status, intent filters, and declared permissions. Continue through [Settings' entry classes](packages/apps/Settings/src/com/android/settings/Settings.java) and [SettingsActivity](packages/apps/Settings/src/com/android/settings/SettingsActivity.java) to the destination fragment or controller. Search the destination class in the Settings project.

From that controller, follow the backing framework API or stored setting. Then locate the service that consumes it and the check that authorizes the operation. The UI, persisted value, and enforcement can live in separate projects. [The application's build definition](packages/apps/Settings/Android.bp) helps explain which libraries the controller can use.

For a LineageOS customization, compare the Settings controller with [common product configuration](vendor/lineage/config/common.mk) and the project selection in [the manifest](default.xml). Some features rely on distribution services or resources outside the shared Settings module. Identify that dependency before treating a UI-only patch as a complete feature.

Produce a small feature notebook: entry activity, controller, preference key or API, service, permission, and policy dependencies. Include concrete file links for each edge found in the snapshot. If a step reaches an unhosted project, record its manifest path and upstream owner instead of inventing a local implementation. This method scales from a visible Settings switch to a platform behavior change and provides a better patch-review checklist than searching for the same label everywhere.

---
id: ch9
title: Chapter 9 — Compare Distributions at the Same Source Boundary
fileRecommendations:
  readingOrder:
    - path: default.xml
      description: Recheck the selected project owners and revisions
      type: source
    - path: frameworks/base/services/java/com/android/server/SystemServer.java
      description: Compare framework service startup at a shared entry point
      type: source
    - path: system/core/init/init.cpp
      description: Compare native platform startup at a shared entry point
      type: source
    - path: packages/apps/Settings/AndroidManifest.xml
      description: Compare the exposed Settings components
      type: source
---

Compare with [GrapheneOS service startup](repo:GrapheneOS/platform_manifest/frameworks/base/services/java/com/android/server/SystemServer.java), [GrapheneOS Binder](repo:GrapheneOS/platform_manifest/frameworks/base/core/java/android/os/Binder.java), and [GrapheneOS Settings](repo:GrapheneOS/platform_manifest/packages/apps/Settings/AndroidManifest.xml). Use [its manifest](repo:GrapheneOS/platform_manifest/default.xml) for project ownership, and [miniageOS](repo:ofdryads/miniageos/README.md) for a smaller product built downstream of LineageOS.

Choose a shared entry point such as [SystemServer](frameworks/base/services/java/com/android/server/SystemServer.java), [init](system/core/init/init.cpp), or [Settings' manifest](packages/apps/Settings/AndroidManifest.xml). Record each project's pinned upstream commit before comparing implementations. Different Android bases can explain changes that would otherwise look distribution-specific. A forked repository name identifies ownership, not the purpose or effect of every patch.

For each difference, classify the affected layer: product composition, module selection, application UI, framework service, native runtime, or policy. Then follow its dependencies with the reading paths above. Keep [the source manifest](default.xml) beside the code so a project replacement or revision change remains visible.

Finish by choosing one feature and explaining its setup requirements, startup path, process boundary, authorization checks, and build module. That exercise turns the manifest into an implementation map and makes gaps in the hosted subset explicit.
