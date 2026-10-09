import { ImageResponse } from 'next/og';

export const alt = 'GitShaman source browser for large repositories';
export const size = { width: 1200, height: 630 };
export const contentType = 'image/png';
export const dynamic = 'force-static';

export default function OpenGraphImage() {
  return new ImageResponse(
    <div
      style={{
        alignItems: 'center',
        background: '#111017',
        color: '#f8f3e7',
        display: 'flex',
        flexDirection: 'column',
        height: '100%',
        justifyContent: 'center',
        padding: '72px',
        width: '100%',
      }}
    >
      <div style={{ color: '#63d8c9', display: 'flex', fontSize: 28, letterSpacing: 5 }}>
        SEMANTIC CODE INTELLIGENCE
      </div>
      <div style={{ display: 'flex', fontSize: 86, fontWeight: 700, marginTop: 26 }}>
        git<span style={{ color: '#efc66f' }}>sha</span>man.com
      </div>
      <div style={{ color: '#aaa4b3', display: 'flex', fontSize: 36, marginTop: 30 }}>
        Open a portal to a GitHub repo. Understand the code faster.
      </div>
    </div>,
    size
  );
}
