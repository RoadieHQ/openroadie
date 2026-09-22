declare global {
  interface SymbolConstructor {
    readonly observable: unique symbol;
  }
}

export {};
