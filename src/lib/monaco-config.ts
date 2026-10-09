/**
 * Monaco Editor configuration
 * Configures local ESM workers before Monaco initialization.
 * The editor's lazy loader supplies the installed Monaco module to loader.config().
 *
 * Workers are automatically bundled into public/monaco-editor/vs by the Next.js plugin
 * Workers are ESM modules that need to be loaded with type: 'module'
 */

/**
 * Configure MonacoEnvironment with ESM worker support
 * This function can be called multiple times safely - it only sets up if not already configured
 */
export function configureMonacoEnvironment(): void {
  if (typeof window === 'undefined') return;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  if (!(window as any).MonacoEnvironment) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (window as any).MonacoEnvironment = {
      getWorkerUrl: function (_moduleId: string, label: string) {
        const basePath = '/monaco-editor/vs';

        if (label === 'json') {
          return `${basePath}/language/json/json.worker.js`;
        }
        if (label === 'css' || label === 'scss' || label === 'less') {
          return `${basePath}/language/css/css.worker.js`;
        }
        if (label === 'html' || label === 'handlebars' || label === 'razor') {
          return `${basePath}/language/html/html.worker.js`;
        }
        if (label === 'typescript' || label === 'javascript') {
          return `${basePath}/language/typescript/ts.worker.js`;
        }
        return `${basePath}/editor/editor.worker.js`;
      },
      getWorker: function (moduleId: string, label: string) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const url = (this as any).getWorkerUrl(moduleId, label);
        // Create Worker with type: 'module' for ESM workers
        return new Worker(url, { type: 'module' });
      },
    };
  }
}
