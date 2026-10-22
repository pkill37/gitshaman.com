import type { AnchorHTMLAttributes } from 'react';

export default function Link({ href, ...props }: AnchorHTMLAttributes<HTMLAnchorElement>) {
  return <a href={href === '/' ? 'https://gitshaman.com/' : href} {...props} />;
}
