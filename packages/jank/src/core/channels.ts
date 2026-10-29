declare const scopeToken: unique symbol;

/** An opaque numeric handle, not a timestamp. Only Channel.begin creates it. */
export type ScopeToken = number & { readonly [scopeToken]: true };

export interface Channel {
  begin(): ScopeToken;
  end(token: ScopeToken): void;
  dispose(): void;
}
