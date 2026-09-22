declare module 'react-helmet';
// `pg-format` ships no types and there's no @types/pg-format on npm.
// Used by packages/backend-defaults/src/services/database/connectors/postgres.ts.
declare module 'pg-format';
declare module '*.svg' {
  const content: string;
  export default content;
}
interface Window {
  themeParametersPromise: Promise<any>;
}
