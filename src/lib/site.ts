export const SITE_NAME = 'gitshaman.com';
export const SITE_URL = 'https://gitshaman.com';
export const SOURCE_REPOSITORY_URL = 'https://github.com/pkill37/gitshaman.com';
export const SOURCE_REPOSITORY_OWNER = 'pkill37';
export const SOURCE_REPOSITORY_NAME = 'gitshaman.com';

export function getSiteUrl(): string {
  return process.env.NEXT_PUBLIC_SITE_URL?.trim() || SITE_URL;
}
