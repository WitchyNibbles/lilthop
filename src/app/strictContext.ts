import { createContext, useContext, type Context } from "react";

/** A context whose hook throws outside its provider, so consumers never handle null. */
export function strictContext<T>(
  name: string,
): readonly [Context<T | null>, () => T] {
  const context = createContext<T | null>(null);
  const useValue = (): T => {
    const value = useContext(context);
    if (value === null) throw new Error(`${name} needs its provider`);
    return value;
  };
  return [context, useValue];
}
