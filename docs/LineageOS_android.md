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

LineageOS combines shared Android projects with its product configuration, SDK, services, and applications. This guide follows PIN-layout scrambling as a worked example: a Settings controller writes a per-user value, a separately identified provider checks access, and SystemUI rearranges its keypad. The other chapters explain how that feature fits into the build and running platform.

The source tour is pinned to the manifest and hosted project commits shown in provenance. Linux links use the separate Linux 6.1 guide as a subsystem baseline; they do not identify the kernel shipped by every LineageOS device. Use the selected device kernel and configuration to establish that boundary in a build. It covers core Android projects and vendor/lineage, not every SDK, device, kernel, vendor, or prebuilt component. Chapter 8 marks the SDK boundary and supplies separately pinned upstream links instead of pretending the provider is hosted locally.

Source opens checkout-relative paths; Manifest opens source-composition files. The editor displays complete eligible text files up to 2 MiB, while symbol indexing examines only their first 64 KiB and text search keeps a shorter prefix of at most 16,384 characters from that input. Methods visible later in a file may not appear in search. Use the method and line links below, and follow upstream provenance for files omitted by the hosting limit. Reference results are bounded text occurrences and heuristic type matches, rather than proven execution paths.

---
id: ch1
title: Chapter 1 — Assemble and Record a LineageOS Checkout
fileRecommendations:
  readingOrder:
    - path: README.mkdn
      description: Pinned branch and Git LFS setup instructions
      type: docs
    - path: default.xml
      description: GitHub default branch and AOSP remote revision
      type: source
    - path: snippets/lineage.xml
      description: Included LineageOS SDK, apps, and distribution projects
      type: source
    - path: build/make/envsetup.sh:lunch
      description: Product, release, and variant selection
      type: source
---

LineageOS's [default manifest](default.xml) combines a GitHub default revision of lineage-24.0 with an AOSP remote pinned to `android-17.0.0_r1`. Revision precedence is project override, selected remote revision, then default revision. Thus frameworks/base inherits the LineageOS branch, while build/blueprint selects the AOSP remote's Android tag. Ignoring the remote revision would misidentify part of the checkout.

The main manifest [includes the distribution fragment](snippets/lineage.xml). That fragment adds the Lineage SDK and other product projects to the selected source graph. A local manifest is a separate Repo mechanism that can further alter a checkout. Distinguish included distribution fragments from changes made by a device builder.

The [pinned README](README.mkdn) supplies this development workflow. Run it in a fresh directory after installing the host prerequisites from the [device build guide](https://wiki.lineageos.org/devices/):

```sh
repo init -u https://github.com/LineageOS/android.git -b lineage-24.0 --git-lfs
repo sync
repo manifest -r -o resolved-manifest.xml
source build/envsetup.sh
lunch --help
```

The branch is movable. The resolved manifest records the commits actually fetched; preserve it with device configuration, proprietary inputs, and build settings. It does not automatically match the older GitShaman core snapshot, whose project commits are shown in file provenance. A manifest commit and a project branch name alone do not freeze a full device build.

Select the target through the chosen device's instructions. This [envsetup implementation](build/make/envsetup.sh:lunch) takes product, release, and variant, with `trunk_staging` as the new-form release default. The GrapheneOS snapshot defaults differently; copying its target string or release assumption is not a substitute for selecting a LineageOS product.

---
id: ch2
title: Chapter 2 — Connect Product Packages to the Settings Module
fileRecommendations:
  readingOrder:
    - path: vendor/lineage/config/common.mk:L151
      description: Common distribution apps and settings-provider package selection
      type: source
    - path: packages/apps/Settings/Android.bp:L198
      description: Settings build module and its privileges
      type: source
    - path: build/make/core/product.mk:inherit-product
      description: Product makefile inheritance
      type: source
    - path: build/soong/android/module.go:InitAndroidModule
      description: Shared Soong module infrastructure
      type: source
---

[Common product configuration](vendor/lineage/config/common.mk:L151) selects LineageParts and LineageSettingsProvider among its packages. This is an installed-artifact decision, separate from [the fragment](snippets/lineage.xml) that makes their source repositories available. A product must inherit the relevant configuration for its package list to apply; a file's presence in the tree does not prove that every target uses it.

Now inspect [Settings' Android.bp](packages/apps/Settings/Android.bp:L198). The app module is named Settings, uses platform APIs, and is privileged. Compare those build attributes with the permissions it requests in [its application manifest](packages/apps/Settings/AndroidManifest.xml). Privileged installation is not a blanket grant of all requested access.

[Product inheritance](build/make/core/product.mk:inherit-product) explains how package lists accumulate. [Soong's module machinery](build/soong/android/module.go:InitAndroidModule) explains how module types fit into the build. The [top-level root.bp](build/soong/root.bp) explains automatic Blueprint discovery; it does not list the active build graph.

After selecting the correct device target, `m Settings` builds the application module and dependencies. A change to PIN scrambling can also require framework/SystemUI or SDK/provider artifacts, depending on the edited layer. Map the files to their owning projects before assuming that rebuilding Settings alone updates the complete feature.

---
id: ch3
title: Chapter 3 — Trace Boot to SystemUI and the Lock Screen
fileRecommendations:
  readingOrder:
    - path: system/core/init/main.cpp:main
      description: Init entry and stage dispatch
      type: source
    - path: system/core/rootdir/init.zygote64.rc
      description: A concrete Zygote service definition
      type: source
    - path: frameworks/base/cmds/app_process/app_main.cpp:main
      description: Native runtime entry
      type: source
    - path: frameworks/base/core/java/com/android/internal/os/ZygoteInit.java:forkSystemServer
      description: Zygote starts system server
      type: source
    - path: frameworks/base/services/java/com/android/server/SystemServer.java:startSystemUi
      description: SystemUI startup request
      type: source
---

The lock screen is not drawn by the Settings application. Begin with [init](system/core/init/main.cpp:main) and [the root boot configuration](system/core/rootdir/init.rc), then inspect [a 64-bit Zygote service](system/core/rootdir/init.zygote64.rc). The device's Zygote property selects the actual imported configuration, so this example is not universal across all targets.

The service executes [app_process](frameworks/base/cmds/app_process/app_main.cpp:main), which enters ZygoteInit. [forkSystemServer](frameworks/base/core/java/com/android/internal/os/ZygoteInit.java:forkSystemServer) leads to the framework's long-lived service process. Locate [startSystemUi](frameworks/base/services/java/com/android/server/SystemServer.java:startSystemUi) to see the request that starts SystemUI. Follow the package/component chosen there rather than assuming SystemUI runs inside system_server.

For the PIN-scrambling case study, this establishes two UI owners: Settings writes the preference, while SystemUI displays the credential keypad. [KeyguardPinViewController.onViewAttached](frameworks/base/packages/SystemUI/src/com/android/keyguard/KeyguardPinViewController.java:onViewAttached) reads the setting when its view attaches. [startAppearAnimation](frameworks/base/packages/SystemUI/src/com/android/keyguard/KeyguardPinViewController.java:startAppearAnimation) reads it again as the keypad appears.

These lifecycle reads are concrete update points. The inspected methods do not establish a continuous live subscription to every setting change. Keep that distinction when testing a preference while the lock-screen view already exists.

### Separate Android startup policy from Linux process machinery

[Android init's service setup](system/core/init/service.cpp:SetProcessAttributesAndCaps) prepares process attributes and capabilities for native services. Compare that userspace policy with [Linux credential handling](repo:torvalds/linux/kernel/cred.c:commit_creds) and [task creation](repo:torvalds/linux/kernel/fork.c:kernel_clone). A Linux task's UID and credentials are kernel state; which service should run with which identity comes from Android configuration and service code.

For applications, follow [the native Zygote fork path](frameworks/base/core/jni/com_android_internal_os_Zygote.cpp:ForkCommon) toward the same Linux task machinery. SystemUI's lock-screen behavior remains userspace code after that process exists. Linux does not shuffle the PIN keypad or interpret the LineageSettings preference.

---
id: ch4
title: Chapter 4 — Identify the IPC Contract behind a Preference
fileRecommendations:
  readingOrder:
    - path: frameworks/base/core/java/android/app/ContextImpl.java:getSystemService
      description: Context lookup path
      type: source
    - path: frameworks/base/core/java/android/app/SystemServiceRegistry.java:getSystemService
      description: Framework manager registry
      type: source
    - path: frameworks/base/core/java/android/content/ContentResolver.java:call
      description: Content-provider call API
      type: source
    - path: packages/apps/Settings/src/com/android/settings/security/screenlock/PinScramblePreferenceController.java:onPreferenceChange
      description: Lineage setting submission
      type: source
    - path: frameworks/native/libs/binder/IPCThreadState.cpp:talkWithDriver
      description: Native userspace Binder ioctl
      type: source
    - path: repo:torvalds/linux/drivers/android/binder.c:binder_ioctl_write_read
      description: Kernel transport for Binder read/write requests
      type: source
---

A feature trace should name the interface that crosses a process boundary. [ContextImpl.getSystemService](frameworks/base/core/java/android/app/ContextImpl.java:getSystemService) delegates manager lookup to [SystemServiceRegistry](frameworks/base/core/java/android/app/SystemServiceRegistry.java:getSystemService). It does not imply that all settings are written through a manager returned by that registry.

The PIN-scrambling [preference callback](packages/apps/Settings/src/com/android/settings/security/screenlock/PinScramblePreferenceController.java:onPreferenceChange) instead uses LineageSettings.System.putInt with a ContentResolver. The Lineage SDK client converts that value to a per-user provider operation; the provider call is the relevant IPC contract. [ContentResolver.call](frameworks/base/core/java/android/content/ContentResolver.java:call) supplies the framework-facing API for provider-defined calls.

The SDK client and provider live in the lineage-sdk project selected by [the included manifest](snippets/lineage.xml). They are outside the hosted core subset. Chapter 8 links a separately pinned upstream SDK revision to close that boundary explicitly. The local core lock covers a separate project set.

For Binder transport below the provider interface, read [Binder](frameworks/base/core/java/android/os/Binder.java) and [IPCThreadState](frameworks/native/libs/binder/IPCThreadState.cpp). Distinguish transport, provider permissions, and preference visibility. A UI controller being available does not establish that another caller can write the same setting.

### Trace provider IPC below the Android API

A content-provider call can cross processes over Binder. To inspect that transport, open [IPCThreadState.talkWithDriver](frameworks/native/libs/binder/IPCThreadState.cpp:talkWithDriver), locate its BINDER_WRITE_READ ioctl, and follow Linux [binder_ioctl_write_read](repo:torvalds/linux/drivers/android/binder.c:binder_ioctl_write_read) into [transaction processing](repo:torvalds/linux/drivers/android/binder.c:binder_transaction). Use [the Binder UAPI definitions](repo:torvalds/linux/include/uapi/linux/android/binder.h) to match the exchanged structures. Provider acquisition and caching can add other steps; a local call need not always cross a process boundary.

The kernel driver does not interpret LOCKSCREEN_PIN_SCRAMBLE_LAYOUT. It transports Binder commands and objects; the SDK provider authorizes the write and stores the setting. Return to [the Settings preference callback](packages/apps/Settings/src/com/android/settings/security/screenlock/PinScramblePreferenceController.java:onPreferenceChange) after reading the kernel code to keep the transport and application contract connected.

---
id: ch5
title: Chapter 5 — Keep Runtime and Library Responsibilities Separate
fileRecommendations:
  readingOrder:
    - path: art/runtime/runtime.cc
      description: Runtime creation and initialization
      type: source
    - path: art/runtime/gc/heap.cc
      description: Managed heap and collection configuration
      type: source
    - path: libcore/ojluni/src/main/java/java/lang/String.java
      description: Java library operations and runtime interaction
      type: source
    - path: bionic/libc/bionic/malloc_common.cpp
      description: Native allocation integration
      type: source
---

LineageOS assembles ART, Libcore, and Bionic as separate manifest projects. Use their pinned commits to identify the runtime baseline before attributing a crash or performance change to a distribution customization. [Runtime initialization](art/runtime/runtime.cc) and [heap configuration](art/runtime/gc/heap.cc) govern managed execution; [String](libcore/ojluni/src/main/java/java/lang/String.java) is a Java library entry point; [malloc integration](bionic/libc/bionic/malloc_common.cpp) belongs to native memory handling.

The PIN layout's list shuffle is application-side Java behavior in SystemUI. Its existence does not imply a special garbage collector, allocator, or credential-storage format. Keep the feature's small view transformation separate from the platform runtime supporting the process.

For a broader memory investigation, first decide whether the failing resource is a managed object, native allocation, or another process's state. Then follow the corresponding project. Comparing only Settings or SystemUI cannot establish a runtime-library regression, and changing the compiler or runtime can affect code whose own source did not change.

Use [GrapheneOS's allocator-selection class](repo:GrapheneOS/platform_manifest/frameworks/base/core/java/android/ext/settings/app/AswUseHardenedMalloc.java) as a contrast in scope: that is explicit distribution configuration around native allocation. The LineageOS PIN example changes keypad presentation. Compare behavior at its actual layer instead of treating all platform patches as the same kind of modification.

### Read Bionic against the Linux syscall boundary

Android's native C library here is Bionic. [Its syscall description file](bionic/libc/SYSCALLS.TXT) distinguishes mmap-related entry points by ABI; generated stubs and architecture conventions connect them to the selected kernel. Compare [Linux do_mmap](repo:torvalds/linux/mm/mmap.c:do_mmap) with [handle_mm_fault](repo:torvalds/linux/mm/memory.c:handle_mm_fault) to distinguish creating virtual address ranges from populating ordinary mappings on access. ART's object and garbage-collection rules remain another layer above these interfaces.

For synchronization, [Bionic's pthread mutex implementation](bionic/libc/bionic/pthread_mutex.cpp:pthread_mutex_lock) can use [its futex helper](bionic/libc/private/bionic_futex.h:__futex_wait_ex). Linux [futex_wait](repo:torvalds/linux/kernel/futex/waitwake.c:futex_wait) implements the wait-side primitive, not the whole pthread mutex algorithm. An uncontended userspace lock need not make a syscall. This is a concrete shared kernel interface despite Bionic and glibc having different userspace implementations.

---
id: ch6
title: Chapter 6 — Separate Keypad Presentation from Graphics and Media Services
fileRecommendations:
  readingOrder:
    - path: frameworks/base/packages/SystemUI/src/com/android/keyguard/KeyguardPINView.java:updatePinScrambling
      description: View-level digit reassignment
      type: source
    - path: frameworks/base/packages/SystemUI/src/com/android/keyguard/NumPadKey.java:setDigit
      description: Updates each key to its assigned digit
      type: source
    - path: frameworks/native/services/surfaceflinger/SurfaceFlinger.cpp
      description: System display composition
      type: source
    - path: frameworks/av/media/libmediaplayerservice/MediaPlayerService.cpp
      description: Playback service implementation
      type: source
---

[updatePinScrambling](frameworks/base/packages/SystemUI/src/com/android/keyguard/KeyguardPINView.java:updatePinScrambling) changes which digit is assigned to each existing keypad view. When scrambling is enabled it shuffles the numbers; when disabled after a state change it restores the default list. It finds the NumPadKey children and calls [setDigit](frameworks/base/packages/SystemUI/src/com/android/keyguard/NumPadKey.java:setDigit). The view's label and input behavior must agree on the assigned digit.

This is a view-level transformation. [SurfaceFlinger](frameworks/native/services/surfaceflinger/SurfaceFlinger.cpp) composes display layers, but it does not choose the keypad's digit permutation. A wrong digit label should first send the investigation to KeyguardPINView and NumPadKey, while composition failures require a different trace through the rendering stack and device support.

[MediaPlayerService](frameworks/av/media/libmediaplayerservice/MediaPlayerService.cpp) is another native service with its own clients and playback implementations. Its presence in the same Android checkout does not make it part of this feature. Use it as a separate exercise in tracing a framework API to native service ownership.

For device-specific display or playback defects, identify the target, component, and manifest project before comparing distribution code. The hosted native services cannot stand in for uninspected GPU drivers, codecs, or vendor hardware implementations.

### Follow graphics buffer ownership to kernel interfaces

[Android's BufferQueue producer](frameworks/native/libs/gui/BufferQueueProducer.cpp) introduces a buffer-ownership boundary below view code. For a separate kernel-side reading exercise, inspect [DMA-buffer export and sharing](repo:torvalds/linux/drivers/dma-buf/dma-buf.c:dma_buf_export) and [dma_buf_mmap](repo:torvalds/linux/drivers/dma-buf/dma-buf.c:dma_buf_mmap). These interfaces help explain buffer sharing between userspace and drivers.

This is an ownership comparison, not a claim that every SurfaceFlinger operation directly calls dma_buf_mmap. The actual allocator, HAL, graphics driver, synchronization, and device configuration determine the path. A wrong PIN digit assignment belongs first to the SystemUI view trace; a buffer-import or driver failure requires the relevant platform and device sources.

---
id: ch7
title: Chapter 7 — Check Provider Authorization and Credential Boundaries
fileRecommendations:
  readingOrder:
    - path: packages/apps/Settings/src/com/android/settings/security/screenlock/PinScramblePreferenceController.java:isPinLock
      description: Feature visibility depends on a secure numeric credential
      type: source
    - path: frameworks/base/packages/SystemUI/src/com/android/keyguard/KeyguardPinViewController.java
      description: Keypad controller and credential submission context
      type: source
    - path: frameworks/base/services/permission/java/com/android/server/permission/access/permission/PermissionService.kt
      description: Runtime-permission implementation
      type: source
    - path: system/sepolicy/private/system_server.te
      description: Platform system-server policy
      type: source
    - path: system/sepolicy/private/app.te
      description: Platform app policy
      type: source
---

[isPinLock](packages/apps/Settings/src/com/android/settings/security/screenlock/PinScramblePreferenceController.java:isPinLock) checks the stored credential quality and whether the user is secure. This controls availability of the preference. Provider-write authorization and PIN verification happen at other boundaries.

The separate SDK provider requires its Lineage settings-write permission for the System-table call used by this feature. Follow the pinned provider implementation in chapter 8 to see where that permission is checked. An app presenting a preference and a process accepted by the provider are different subjects of review.

PIN scrambling does not change the credential itself. [The controller](frameworks/base/packages/SystemUI/src/com/android/keyguard/KeyguardPinViewController.java) still participates in the normal unlock flow while the keypad view changes its digit assignments. Do not infer stronger PIN entropy, changed lockout behavior, or a different credential verifier from the shuffle implementation.

[Runtime permission management](frameworks/base/services/permission/java/com/android/server/permission/access/permission/PermissionService.kt), [system-server SELinux rules](system/sepolicy/private/system_server.te), and [app-domain policy](system/sepolicy/private/app.te) remain other enforcement layers. The device's final policy has inputs outside this snapshot. For this case study, identify the provider permission and selected user before moving to SELinux diagnostics; do not invent a policy change merely because the feature is security-related.

### Keep Linux MAC enforcement beside provider permissions

[Linux's SELinux Binder hook](repo:torvalds/linux/security/selinux/hooks.c:selinux_binder_transaction) and [AVC permission checks](repo:torvalds/linux/security/selinux/avc.c:avc_has_perm) provide a kernel authorization layer underneath provider IPC. Android's [app policy](system/sepolicy/private/app.te) and [policy macros](system/sepolicy/public/te_macros) help describe the policy inputs; the provider's Lineage write permission still checks the requested operation in userspace.

A denial at either layer can stop the preference update, but the diagnostic evidence differs. Identify the service permission and user for a provider error, or the source/target contexts and class for an SELinux denial. Passing the kernel transport check does not prove that a caller may change the stored preference or unlock a device.

---
id: ch8
title: Chapter 8 — Worked Trace — Scramble the Lock-Screen PIN Layout
fileRecommendations:
  readingOrder:
    - path: packages/apps/Settings/src/com/android/settings/password/ChooseLockGeneric.java
      description: Constructs the PIN-scrambling preference controller
      type: source
    - path: packages/apps/Settings/src/com/android/settings/security/screenlock/PinScramblePreferenceController.java:onPreferenceChange
      description: Writes the boolean as a Lineage setting
      type: source
    - path: frameworks/base/packages/SystemUI/src/com/android/keyguard/KeyguardPinViewController.java:onViewAttached
      description: Reads the selected user setting
      type: source
    - path: frameworks/base/packages/SystemUI/src/com/android/keyguard/KeyguardPINView.java:updatePinScrambling
      description: Shuffles or restores keypad digits
      type: source
    - path: frameworks/base/packages/SystemUI/src/com/android/keyguard/NumPadKey.java:setDigit
      description: Applies each assigned digit
      type: source
---

Start at [ChooseLockGeneric](packages/apps/Settings/src/com/android/settings/password/ChooseLockGeneric.java), which constructs PinScramblePreferenceController. Its [availability check](packages/apps/Settings/src/com/android/settings/security/screenlock/PinScramblePreferenceController.java:isPinLock) requires a secure numeric credential. [updateState](packages/apps/Settings/src/com/android/settings/security/screenlock/PinScramblePreferenceController.java:updateState) reads LOCKSCREEN_PIN_SCRAMBLE_LAYOUT with a default of zero; [onPreferenceChange](packages/apps/Settings/src/com/android/settings/security/screenlock/PinScramblePreferenceController.java:onPreferenceChange) writes one or zero using LineageSettings.System.putInt.

The provider boundary is outside the hosted snapshot. The following companion links use SDK commit `49948877d217b8a5374e3e56253a4ce35f82fc54`, separately inspected for this guide and outside GitShaman's core lock. [LineageSettings](https://github.com/LineageOS/android_lineage-sdk/blob/49948877d217b8a5374e3e56253a4ce35f82fc54/sdk/src/java/lineageos/providers/LineageSettings.java#L1689) defines the setting key. Its integer-write API reaches a per-user provider call. [The provider's PUT_system branch](https://github.com/LineageOS/android_lineage-sdk/blob/49948877d217b8a5374e3e56253a4ce35f82fc54/packages/LineageSettingsProvider/src/org/lineageos/lineagesettings/LineageSettingsProvider.java#L169) checks the Lineage WRITE_SETTINGS permission before writing. [Its manifest](https://github.com/LineageOS/android_lineage-sdk/blob/49948877d217b8a5374e3e56253a4ce35f82fc54/packages/LineageSettingsProvider/AndroidManifest.xml#L31) also declares write access requirements. The [distribution fragment](snippets/lineage.xml) identifies the SDK project, and [common product configuration](vendor/lineage/config/common.mk:L151) selects its provider module.

On the consumer side, [KeyguardPinViewController.onViewAttached](frameworks/base/packages/SystemUI/src/com/android/keyguard/KeyguardPinViewController.java:onViewAttached) reads the setting for the selected user. [startAppearAnimation](frameworks/base/packages/SystemUI/src/com/android/keyguard/KeyguardPinViewController.java:startAppearAnimation) repeats that read. Both pass the result to [updatePinScrambling](frameworks/base/packages/SystemUI/src/com/android/keyguard/KeyguardPINView.java:updatePinScrambling), which shuffles or restores the digit list and updates each [NumPadKey](frameworks/base/packages/SystemUI/src/com/android/keyguard/NumPadKey.java:setDigit). The Settings write uses its ContentResolver's user; the consumer explicitly chooses the selected lock-screen user. Preserve that distinction in multi-user testing.

This closes the route: Settings controller → per-user provider write and authorization → SystemUI read → keypad digit assignment. Test disabled, enabled, and restored layouts with a disposable development credential. Check that a key enters the digit it displays, and re-open the keypad to exercise the documented lifecycle reads. The feature changes presentation; the inspected trace does not establish a new credential-verification mechanism.

---
id: ch9
title: Chapter 9 — Compare Features, Provenance, and Missing Projects
fileRecommendations:
  readingOrder:
    - path: snippets/lineage.xml
      description: Distribution-specific source projects
      type: source
    - path: vendor/lineage/config/common.mk:L151
      description: Distribution-specific installed components
      type: source
    - path: repo:GrapheneOS/platform_manifest/config.yml
      description: GrapheneOS composition configuration
      type: source
    - path: repo:GrapheneOS/platform_manifest/frameworks/base/core/java/com/android/internal/os/ZygoteConnection.java:L276
      description: GrapheneOS exec-spawning launch branch
      type: source
---

The LineageOS example spans source selection, product installation, Settings, the SDK provider, and SystemUI. [The included fragment](snippets/lineage.xml) selects SDK source; [common product configuration](vendor/lineage/config/common.mk:L151) selects the provider artifact; the two UI projects write and consume the setting. These are concrete responsibilities, not interchangeable descriptions of a manifest project.

Compare that route with [GrapheneOS's composition input](repo:GrapheneOS/platform_manifest/config.yml) and [exec-spawning implementation](repo:GrapheneOS/platform_manifest/frameworks/base/core/java/com/android/internal/os/ZygoteConnection.java:L276). In its guide, the per-app switch crosses IPackageManager, is filtered by GrapheneOS package-state policy, and affects process launch. The LineageOS PIN control uses a settings provider and changes a view. Both involve Settings, but their IPC contracts and runtime effects differ.

The pinned manifests share the AOSP `android-17.0.0_r1` baseline; that does not make the fork commits identical. Record the exact project commits from provenance when comparing [LineageOS service startup](frameworks/base/services/java/com/android/server/SystemServer.java:startSystemUi) with [GrapheneOS startup](repo:GrapheneOS/platform_manifest/frameworks/base/services/java/com/android/server/SystemServer.java:startSystemUi). Explain a changed call or condition before attributing a behavior to one distribution.

The companion SDK revision in chapter 8 is an explicit external dependency of this source tour. Recheck it against a resolved manifest before reproducing a full build. Keeping that boundary visible is more useful than treating the hosted core subset as a complete LineageOS device checkout.
