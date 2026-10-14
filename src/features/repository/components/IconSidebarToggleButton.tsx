import type { ReactNode } from 'react';

interface IconSidebarToggleButtonProps {
  onClick: () => void;
  label: string;
  children: ReactNode;
  size?: number;
  borderRadius?: number;
}

export default function IconSidebarToggleButton({
  onClick,
  label,
  children,
  size = 24,
  borderRadius = 3,
}: IconSidebarToggleButtonProps) {
  return (
    <button
      onClick={onClick}
      title={label}
      aria-label={label}
      style={{
        width: size,
        height: size,
        borderRadius,
        border: '1px solid var(--vscode-border)',
        background: 'transparent',
        color: 'var(--vscode-text-secondary)',
        cursor: 'pointer',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        fontSize: 16,
        lineHeight: 1,
        padding: 0,
      }}
      onMouseEnter={(e) => {
        e.currentTarget.style.background = 'var(--vscode-bg-hover)';
        e.currentTarget.style.borderColor =
          'var(--repo-accent, var(--vscode-text-accent, #0078d4))';
        e.currentTarget.style.color = 'var(--vscode-text-primary)';
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.background = 'transparent';
        e.currentTarget.style.borderColor = 'var(--vscode-border)';
        e.currentTarget.style.color = 'var(--vscode-text-secondary)';
      }}
    >
      {children}
    </button>
  );
}
