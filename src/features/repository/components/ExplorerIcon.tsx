interface ExplorerIconProps {
  kind?: 'file' | 'folder' | 'folder-open' | 'warning';
  size?: number;
}

export default function ExplorerIcon({ kind = 'file', size = 16 }: ExplorerIconProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.75"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      style={{ flexShrink: 0, verticalAlign: 'middle' }}
    >
      {kind === 'folder' ? (
        <path d="M3 7V5a2 2 0 0 1 2-2h5l2 3h7a2 2 0 0 1 2 2v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7Z" />
      ) : kind === 'folder-open' ? (
        <>
          <path d="M3 18V5a2 2 0 0 1 2-2h5l2 3h7a2 2 0 0 1 2 2v2" />
          <path d="M3 19 6 10h16l-3 9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2Z" />
        </>
      ) : kind === 'warning' ? (
        <>
          <path d="m12 3 10 18H2L12 3Z" />
          <path d="M12 9v4m0 4h.01" />
        </>
      ) : (
        <>
          <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8l-6-6Z" />
          <path d="M14 2v6h6M8 13h8m-8 4h6" />
        </>
      )}
    </svg>
  );
}
