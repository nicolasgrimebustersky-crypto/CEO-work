"use client";

import { createContext, useContext } from "react";

/**
 * Opening the drawer, available to anything inside the shell.
 *
 * Two places open it — the "More" tab and the hamburger in each screen header
 * — and the map draws its own floating version over the satellite view. A
 * context beats threading a callback through every screen for that.
 */
export const MenuContext = createContext<(() => void) | null>(null);

/** Returns null outside the shell (a public page has no navigation). */
export function useOpenMenu(): (() => void) | null {
  return useContext(MenuContext);
}
