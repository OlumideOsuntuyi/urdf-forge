declare module "occt-import-js" {
  const factory: (options?: { locateFile?: (path: string) => string }) => Promise<unknown>;
  export default factory;
}

/** Injected by Vite from package.json. */
declare const __APP_VERSION__: string;
