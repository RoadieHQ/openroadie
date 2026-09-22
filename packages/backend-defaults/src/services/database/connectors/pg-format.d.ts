declare module 'pg-format' {
  function format(fmt: string, ...args: unknown[]): string;
  export = format;
}
