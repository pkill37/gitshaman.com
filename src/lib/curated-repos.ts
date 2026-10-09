export interface CuratedRepoConfig {
  id: string;
  owner: string;
  repo: string;
  /** SEO-friendly canonical route segment (e.g. "/linux-kernel"). */
  slug: string;
  /** Human-readable pinned reference label shown in the UI. */
  ref: string;
  /** Canonical locked revision used for local/static storage and trusted fetches. */
  revision: string;
  /** Guide document that is authored against this exact curated revision. */
  guideId: string;
  displayName: string;
  description: string;
  seoDescription: string;
  seoKeywords: string[];
  sitemapPriority: number;
  icon?: string;
  gradient?: string;
  category?: string;
  dimmed?: boolean;
  /** Filename under /avatars/ (e.g. "gnu.png"). Defaults to "{owner}.png". */
  avatarFile?: string;
  /** URL to fetch the avatar from at build time. Defaults to github.com/{owner}.png */
  buildAvatarUrl?: string;
  /** Optional build-time version marker for refreshing a specific avatar asset. */
  avatarVersion?: string;
}

export const CURATED_REPOS: CuratedRepoConfig[] = [
  {
    id: 'linux-v6.1',
    owner: 'torvalds',
    repo: 'linux',
    slug: 'linux-kernel',
    ref: 'v6.1',
    revision: 'v6.1',
    guideId: 'linux-kernel-guide',
    displayName: 'Linux',
    icon: '🐧',
    gradient: 'from-orange-500/10 to-red-500/10',
    category: 'Operating Systems',
    avatarFile: 'tux.png',
    buildAvatarUrl: 'https://commons.wikimedia.org/wiki/Special:Redirect/file/Tux.svg?width=256',
    description:
      'Linux kernel source code, with kernel architecture, system calls, device drivers, and core subsystems.',
    seoDescription:
      'Explore the Linux kernel source code interactively. Study kernel architecture, system calls, device drivers, and core subsystems with guided learning paths.',
    seoKeywords: [
      'Linux kernel',
      'kernel source code',
      'kernel development',
      'system programming',
      'device drivers',
      'kernel architecture',
      'operating systems',
      'Linux internals',
    ],
    sitemapPriority: 0.9,
  },
  {
    id: 'apple-xnu',
    owner: 'apple-oss-distributions',
    repo: 'xnu',
    slug: 'xnu-kernel',
    ref: 'xnu-12377.1.9',
    revision: 'xnu-12377.1.9',
    guideId: 'xnu-kernel-guide',
    displayName: 'XNU',
    icon: '🍎',
    gradient: 'from-gray-500/10 to-slate-500/10',
    category: 'Operating Systems',
    description:
      "Apple's XNU kernel, the hybrid Mach/BSD core powering macOS and iOS. Study Mach IPC, virtual memory, I/O Kit drivers, and the BSD subsystem.",
    seoDescription:
      "Explore Apple's XNU kernel source code interactively. Study Mach IPC, virtual memory, I/O Kit drivers, BSD internals, and the hybrid kernel architecture behind macOS and iOS.",
    seoKeywords: [
      'XNU',
      'Apple kernel',
      'Mach kernel',
      'BSD kernel',
      'macOS internals',
      'iOS internals',
      'kernel architecture',
      'systems programming',
    ],
    sitemapPriority: 0.9,
  },
  {
    id: 'freebsd-src-15.1',
    owner: 'freebsd',
    repo: 'freebsd-src',
    slug: 'freebsd-kernel',
    ref: 'releng/15.1',
    revision: 'aadd58dddcbc78f4d5594827b46b5633552b15ce',
    guideId: 'freebsd-kernel-guide',
    displayName: 'FreeBSD',
    icon: '😈',
    gradient: 'from-red-500/10 to-stone-500/10',
    category: 'Operating Systems',
    description:
      'FreeBSD source tree, focused on the kernel, boot path, device drivers, networking stack, VM, VFS, and release-engineered base system.',
    seoDescription:
      'Explore the FreeBSD kernel source code from the FreeBSD 15.1 release branch. Study sys/, boot, VM, VFS, networking, device drivers, and kernel configuration.',
    seoKeywords: [
      'FreeBSD kernel',
      'BSD kernel',
      'FreeBSD source code',
      'sys kernel',
      'VFS',
      'network stack',
      'device drivers',
      'operating systems',
    ],
    sitemapPriority: 0.85,
  },
  {
    id: 'ghostbsd-src',
    owner: 'ghostbsd',
    repo: 'ghostbsd-src',
    slug: 'ghostbsd-kernel',
    ref: 'main',
    revision: 'b3f9cf4fa7f35fa8b084353e0dff0aa4799fc542',
    guideId: 'ghostbsd-kernel-guide',
    displayName: 'GhostBSD',
    icon: '👻',
    gradient: 'from-teal-500/10 to-zinc-500/10',
    category: 'Operating Systems',
    description:
      'GhostBSD core operating system source, a FreeBSD-derived tree tuned for desktop use and hardware support.',
    seoDescription:
      'Explore the GhostBSD source tree interactively. Study its FreeBSD-derived kernel, desktop-oriented defaults, device support, and base-system integration.',
    seoKeywords: [
      'GhostBSD',
      'GhostBSD kernel',
      'BSD desktop',
      'FreeBSD derivative',
      'kernel source code',
      'device drivers',
      'operating systems',
      'BSD internals',
    ],
    sitemapPriority: 0.75,
  },
  {
    id: 'nextbsd-kernel',
    owner: 'nextbsd-redux',
    repo: 'nextbsd-kernel',
    slug: 'nextbsd-kernel',
    ref: 'main',
    revision: 'dcfa0cda0600d7ecce6216adcc7d8b31982ef702',
    guideId: 'nextbsd-kernel-guide',
    displayName: 'NextBSD',
    icon: '🧬',
    gradient: 'from-violet-500/10 to-emerald-500/10',
    category: 'Operating Systems',
    description:
      'NextBSD kernel patch and configuration repository, layering Mach-oriented behavior and NextBSD policy on a FreeBSD kernel base.',
    seoDescription:
      'Explore the NextBSD kernel repository. Study its FreeBSD kernel patch series, NEXTBSD kernel config, source overlays, and build workflow.',
    seoKeywords: [
      'NextBSD',
      'NextBSD kernel',
      'BSD kernel',
      'Mach IPC',
      'FreeBSD patches',
      'kernel configuration',
      'operating systems',
      'Darwin BSD',
    ],
    sitemapPriority: 0.75,
  },
  {
    id: 'windows-server-2003-anika',
    owner: 'mrcxlinux',
    repo: 'srv03rtm-anika',
    slug: 'nt5.1-kernel',
    ref: '9e4d6bae9ed79e542f0f3ab463d6b00866019ec1',
    revision: '9e4d6bae9ed79e542f0f3ab463d6b00866019ec1',
    guideId: 'windows-server-2003-guide',
    displayName: 'NT5.1',
    icon: '🪟',
    gradient: 'from-sky-500/10 to-blue-500/10',
    category: 'Operating Systems',
    avatarFile: 'windows-server-2003.svg',
    buildAvatarUrl: 'local:windows-server-2003.svg',
    avatarVersion: '1',
    description:
      'Windows Server 2003 source tree, with focus on its build layout, core subsystem families, and server-oriented components.',
    seoDescription:
      'Explore the Windows Server 2003 source tree interactively. Study the build layout, subsystem organization, server components, networking stack, and developer tooling behind the NT 5.2 codebase.',
    seoKeywords: [
      'Windows Server 2003',
      'Windows internals',
      'NT source code',
      'source tree',
      'Razzle build',
      'server operating system',
      'systems programming',
      'Windows source code',
    ],
    sitemapPriority: 0.75,
  },
  {
    id: 'littlekernel-lk',
    owner: 'littlekernel',
    repo: 'lk',
    slug: 'little-kernel',
    ref: 'a521fe60e1a16d5670fe24b7fca2c5155b3339c4',
    revision: 'a521fe60e1a16d5670fe24b7fca2c5155b3339c4',
    guideId: 'littlekernel-lk-guide',
    displayName: 'LK',
    icon: '🧩',
    gradient: 'from-emerald-500/10 to-cyan-500/10',
    category: 'Operating Systems',
    description:
      'LK, a small SMP-aware embedded kernel used in bootloaders and bring-up environments across many architectures.',
    seoDescription:
      'Explore the Little Kernel (LK) embedded kernel source code. Study its tiny kernel core, platform ports, target configuration model, and modular embedded build system.',
    seoKeywords: [
      'Little Kernel',
      'LK kernel',
      'embedded kernel',
      'bootloader kernel',
      'RTOS',
      'kernel bring-up',
      'embedded systems',
      'platform porting',
    ],
    sitemapPriority: 0.8,
  },
  {
    id: 'sel4-15.0.0',
    owner: 'seL4',
    repo: 'seL4',
    slug: 'sel4-microkernel',
    ref: '15.0.0',
    revision: '15.0.0',
    guideId: 'sel4-guide',
    displayName: 'seL4',
    icon: '⚙️',
    gradient: 'from-slate-500/10 to-zinc-500/10',
    category: 'Operating Systems',
    description:
      'seL4, the formally verified microkernel with a capability-based kernel model, generated ABI bindings, and architecture-specific ports.',
    seoDescription:
      'Explore the seL4 microkernel source code interactively. Study capability-based isolation, kernel boot flow, generated syscalls, scheduling, and architecture ports in seL4 15.0.0.',
    seoKeywords: [
      'seL4',
      'microkernel',
      'capability kernel',
      'formal verification',
      'kernel boot',
      'syscall generation',
      'operating systems',
      'systems programming',
    ],
    sitemapPriority: 0.8,
  },
  {
    id: 'reactos',
    owner: 'reactos',
    repo: 'reactos',
    slug: 'reactos',
    ref: '0.4.16',
    revision: '0.4.16',
    guideId: 'reactos-guide',
    displayName: 'ReactOS',
    icon: '🪟',
    gradient: 'from-sky-500/10 to-cyan-500/10',
    category: 'Operating Systems',
    description:
      'ReactOS, a Windows-compatible open source operating system focused on NT kernel, Win32, and driver compatibility.',
    seoDescription:
      'Explore the ReactOS source code interactively. Study its NT kernel architecture, Win32 subsystem, driver model, boot flow, and Windows compatibility layers.',
    seoKeywords: [
      'ReactOS',
      'Windows-compatible OS',
      'NT kernel',
      'Win32',
      'driver compatibility',
      'operating system internals',
      'systems programming',
      'open source OS',
    ],
    sitemapPriority: 0.75,
  },
  {
    id: 'lineageos-android',
    owner: 'LineageOS',
    repo: 'android',
    slug: 'lineageos-android',
    ref: 'lineage-24.0',
    revision: '2a50ca061bffe4e73918ae2e0b99b7a05f647154',
    guideId: 'lineageos-android-guide',
    displayName: 'LineageOS',
    icon: '🤖',
    avatarFile: 'lineageos.svg',
    buildAvatarUrl: 'local:lineageos.svg',
    gradient: 'from-emerald-500/10 to-cyan-500/10',
    category: 'AOSP',
    description:
      'LineageOS Android platform manifest, the repo entry point for syncing and studying its Android distribution source tree.',
    seoDescription:
      'Explore the LineageOS Android platform manifest. Study how LineageOS composes AOSP, project forks, device trees, vendor layers, and Android distribution source syncs.',
    seoKeywords: [
      'LineageOS',
      'AOSP',
      'Android source code',
      'Android platform manifest',
      'custom Android ROM',
      'mobile operating system',
      'repo manifest',
      'Android distribution',
    ],
    sitemapPriority: 0.75,
  },
  {
    id: 'grapheneos-platform-manifest',
    owner: 'GrapheneOS',
    repo: 'platform_manifest',
    slug: 'grapheneos-platform-manifest',
    ref: '17',
    revision: '0493b9e3a3ae90faf39bd7979a03df5e5dc63a0a',
    guideId: 'grapheneos-platform-manifest-guide',
    displayName: 'GrapheneOS',
    icon: '🛡️',
    avatarFile: 'grapheneos.svg',
    buildAvatarUrl: 'local:grapheneos.svg',
    gradient: 'from-slate-500/10 to-emerald-500/10',
    category: 'AOSP',
    description:
      'GrapheneOS platform manifest, the source composition layer for its privacy and security-hardened Android distribution.',
    seoDescription:
      'Explore the GrapheneOS platform manifest. Study how GrapheneOS composes AOSP, security hardening forks, device support, and Android source syncs.',
    seoKeywords: [
      'GrapheneOS',
      'AOSP',
      'Android security',
      'Android privacy',
      'platform manifest',
      'mobile operating system',
      'repo manifest',
      'hardened Android',
    ],
    sitemapPriority: 0.75,
  },
  {
    id: 'miniageos',
    owner: 'ofdryads',
    repo: 'miniageos',
    slug: 'miniageos',
    ref: 'main',
    revision: 'b64d081c60bc6ea28447efdeed6cfcce5aabf1f0',
    guideId: 'miniageos-guide',
    displayName: 'miniageOS',
    icon: '📱',
    avatarFile: 'miniageos.svg',
    buildAvatarUrl: 'local:miniageos.svg',
    gradient: 'from-lime-500/10 to-teal-500/10',
    category: 'AOSP',
    description:
      'miniageOS, a small LineageOS-based toolkit for building a stripped-down Google Pixel dumbphone experience.',
    seoDescription:
      'Explore miniageOS source code. Study its LineageOS-based scripts, Android customization workflow, Pixel-focused setup, and minimalist mobile operating system approach.',
    seoKeywords: [
      'miniageOS',
      'LineageOS',
      'AOSP',
      'Android dumbphone',
      'Google Pixel',
      'Android customization',
      'minimalist phone',
      'mobile operating system',
    ],
    sitemapPriority: 0.65,
  },
  {
    id: 'python-cpython-3.14.0',
    owner: 'python',
    repo: 'cpython',
    slug: 'cpython',
    ref: 'v3.14.0',
    revision: 'v3.14.0',
    guideId: 'cpython-guide',
    displayName: 'CPython',
    icon: '🐍',
    gradient: 'from-yellow-500/10 to-blue-500/10',
    category: 'Languages',
    description:
      'Python interpreter source code, from bytecode execution to garbage collection and runtime behavior.',
    seoDescription:
      'Explore Python CPython interpreter source code. Learn how Python works under the hood, from bytecode execution to garbage collection and runtime internals.',
    seoKeywords: [
      'CPython',
      'Python source code',
      'Python interpreter',
      'Python internals',
      'bytecode',
      'garbage collection',
      'Python implementation',
      'programming language',
    ],
    sitemapPriority: 0.9,
  },
  {
    id: 'go-1.27.0',
    owner: 'golang',
    repo: 'go',
    slug: 'go-language',
    ref: 'go1.27.0',
    revision: 'go1.27.0',
    guideId: 'go-language-guide',
    displayName: 'Go',
    icon: 'Go',
    gradient: 'from-cyan-500/10 to-emerald-500/10',
    category: 'Languages',
    avatarFile: 'golang.svg',
    buildAvatarUrl: 'local:golang.svg',
    description:
      'Go programming language source code, including the compiler, runtime, go command, and standard library.',
    seoDescription:
      'Explore the Go programming language source code. Study the Go compiler, runtime scheduler, garbage collector, go command, modules, and standard library internals.',
    seoKeywords: [
      'Go language',
      'Golang source code',
      'Go compiler',
      'Go runtime',
      'Go garbage collector',
      'goroutines',
      'Go modules',
      'programming language internals',
    ],
    sitemapPriority: 0.9,
  },
  {
    id: 'typescript-go-7.0.2',
    owner: 'microsoft',
    repo: 'typescript-go',
    slug: 'typescript-compiler',
    ref: 'typescript/v7.0.2',
    revision: '2bd066d87f5bafd315be9f40889d0a60b9e58e0b',
    guideId: 'typescript-compiler-guide',
    displayName: 'TS-Go',
    icon: 'TS',
    gradient: 'from-blue-500/10 to-teal-500/10',
    category: 'Languages',
    avatarFile: 'typescript.svg',
    buildAvatarUrl: 'local:typescript.svg',
    description:
      'TypeScript 7 native compiler source code, including parsing, binding, type checking, emit, project builds, and language tooling.',
    seoDescription:
      'Explore the TypeScript 7 native compiler source code. Study the Go implementation of parsing, binding, type checking, module resolution, emit, project builds, and language service internals.',
    seoKeywords: [
      'TypeScript compiler',
      'TypeScript source code',
      'TypeScript internals',
      'typescript-go',
      'tsgo',
      'type checker',
      'language service',
      'programming language internals',
    ],
    sitemapPriority: 0.9,
  },
  {
    id: 'glibc-2.39',
    owner: 'bminor',
    repo: 'glibc',
    slug: 'gnu-c-library',
    ref: 'glibc-2.39',
    revision: 'glibc-2.39',
    guideId: 'glibc-guide',
    displayName: 'glibc',
    icon: '🖥️',
    gradient: 'from-orange-500/10 to-red-500/10',
    category: 'Operating Systems',
    avatarFile: 'gnu.png',
    buildAvatarUrl:
      'https://commons.wikimedia.org/wiki/Special:Redirect/file/Heckert_GNU_white.svg?width=256',
    description:
      'GNU C Library source code, including standard C library implementations, system calls, and POSIX compliance.',
    seoDescription:
      'Explore the GNU C Library (glibc) source code. Study standard C library implementations, system calls, POSIX compliance, and C runtime behavior.',
    seoKeywords: [
      'glibc',
      'GNU C Library',
      'C standard library',
      'system calls',
      'POSIX',
      'systems programming',
      'C runtime',
      'libc',
    ],
    sitemapPriority: 0.8,
  },
  {
    id: 'llvm-18.1.0',
    owner: 'llvm',
    repo: 'llvm-project',
    slug: 'llvm-project',
    ref: 'llvmorg-18.1.0',
    revision: 'llvmorg-18.1.0',
    guideId: 'llvm-guide',
    displayName: 'LLVM',
    icon: '⚙️',
    gradient: 'from-blue-500/10 to-cyan-500/10',
    category: 'Languages',
    avatarFile: 'llvm-dragon.png',
    buildAvatarUrl: 'https://llvm.org/img/DragonMedium.png',
    description:
      'LLVM compiler infrastructure, including compiler design, optimization passes, and code generation.',
    seoDescription:
      'Explore the LLVM compiler infrastructure source code. Study compiler design, optimization passes, code generation, and modern compiler architecture.',
    seoKeywords: [
      'LLVM',
      'compiler infrastructure',
      'compiler design',
      'code optimization',
      'code generation',
      'compiler architecture',
      'Clang',
      'compiler engineering',
    ],
    sitemapPriority: 0.8,
  },
];

function validateCuratedRepos(repos: CuratedRepoConfig[]): void {
  const ids = new Set<string>();
  const repoKeys = new Set<string>();
  const guideIds = new Set<string>();
  const slugs = new Set<string>();

  for (const repo of repos) {
    if (!repo.id || !repo.slug || !repo.ref || !repo.revision || !repo.guideId) {
      throw new Error(
        `Curated repo ${repo.owner}/${repo.repo} is missing required lock fields (id/slug/ref/revision/guideId).`
      );
    }

    if (ids.has(repo.id)) {
      throw new Error(`Duplicate curated repo id: ${repo.id}`);
    }
    ids.add(repo.id);

    const repoKey = toRepoKey(repo.owner, repo.repo);
    if (repoKeys.has(repoKey)) {
      throw new Error(`Duplicate curated repo key: ${repoKey}`);
    }
    repoKeys.add(repoKey);

    if (guideIds.has(repo.guideId)) {
      throw new Error(`Duplicate curated guide id: ${repo.guideId}`);
    }
    guideIds.add(repo.guideId);

    if (slugs.has(repo.slug)) {
      throw new Error(`Duplicate curated repo slug: ${repo.slug}`);
    }
    slugs.add(repo.slug);
  }
}

export function toRepoKey(owner: string, repo: string): string {
  return `${owner}/${repo}`;
}

export function getCuratedRepo(owner: string, repo: string): CuratedRepoConfig | null {
  return CURATED_REPOS.find((entry) => entry.owner === owner && entry.repo === repo) ?? null;
}

export function getCuratedRepoBySlug(slug: string): CuratedRepoConfig | null {
  return CURATED_REPOS.find((entry) => entry.slug === slug) ?? null;
}

export function isCuratedRepo(owner: string, repo: string): boolean {
  return getCuratedRepo(owner, repo) !== null;
}

export function getCuratedRepoRevision(owner: string, repo: string): string {
  return getCuratedRepo(owner, repo)?.revision ?? '';
}

export function getCuratedRepoRef(owner: string, repo: string): string {
  return getCuratedRepo(owner, repo)?.ref ?? '';
}

export function getCuratedRepoId(owner: string, repo: string): string {
  return getCuratedRepo(owner, repo)?.id ?? '';
}

const CURATED_REPO_ACCENTS: Record<string, string> = {
  'torvalds/linux': '#0ea5e9',
  'apple-oss-distributions/xnu': '#f97316',
  'freebsd/freebsd-src': '#ef4444',
  'ghostbsd/ghostbsd-src': '#14b8a6',
  'nextbsd-redux/nextbsd-kernel': '#a855f7',
  'mrcxlinux/srv03rtm-anika': '#2563eb',
  'littlekernel/lk': '#22c55e',
  'seL4/seL4': '#eab308',
  'reactos/reactos': '#06b6d4',
  'LineageOS/android': '#00a86b',
  'GrapheneOS/platform_manifest': '#10b981',
  'ofdryads/miniageos': '#84cc16',
  'python/cpython': '#f59e0b',
  'golang/go': '#00add8',
  'microsoft/typescript-go': '#3178c6',
  'bminor/glibc': '#dc2626',
  'llvm/llvm-project': '#8b5cf6',
};

export function getCuratedRepoAccent(owner: string, repo: string): string {
  return CURATED_REPO_ACCENTS[toRepoKey(owner, repo)] ?? '#64748b';
}

export function getCuratedRepoDisplayName(owner: string, repo: string): string {
  return getCuratedRepo(owner, repo)?.displayName ?? `${owner}/${repo}`;
}

export function getCuratedRepoPath(owner: string, repo: string): string {
  const config = getCuratedRepo(owner, repo);
  return config ? `/${config.slug}` : `/${owner}/${repo}`;
}

export interface CuratedRepoRouteResolution {
  config: CuratedRepoConfig;
  canonicalPath: string;
  isLegacyPath: boolean;
}

export interface CuratedRepoRouteParams {
  repoPath: string[];
}

export function getCuratedRepoRouteParams(): CuratedRepoRouteParams[] {
  return CURATED_REPOS.flatMap((repo) => [
    { repoPath: [repo.slug] },
    { repoPath: [repo.owner, repo.repo] },
  ]);
}

export function resolveCuratedRepoRoute(pathSegments: string[]): CuratedRepoRouteResolution | null {
  if (pathSegments.length === 1) {
    const config = getCuratedRepoBySlug(pathSegments[0]);
    if (!config) {
      return null;
    }

    return {
      config,
      canonicalPath: `/${config.slug}`,
      isLegacyPath: false,
    };
  }

  if (pathSegments.length === 2) {
    const [owner, repo] = pathSegments;
    const config = getCuratedRepo(owner, repo);
    if (!config) {
      return null;
    }

    return {
      config,
      canonicalPath: getCuratedRepoPath(owner, repo),
      isLegacyPath: true,
    };
  }

  return null;
}

validateCuratedRepos(CURATED_REPOS);
