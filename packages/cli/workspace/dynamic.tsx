import { lazy, Suspense, type ComponentType } from 'react';

// The standalone browser bundle uses the same editor component without a Next runtime.
export default function dynamic<P extends object>(
  load: () => Promise<ComponentType<P> | { default: ComponentType<P> }>,
  options: { loading?: ComponentType; ssr?: boolean }
): ComponentType<P> {
  const Component = lazy(async () => {
    const loaded = await load();
    return { default: 'default' in loaded ? loaded.default : loaded };
  });
  const Loading = options.loading;
  return function LocalDynamic(props: P) {
    return (
      <Suspense fallback={Loading ? <Loading /> : null}>
        <Component {...props} />
      </Suspense>
    );
  };
}
