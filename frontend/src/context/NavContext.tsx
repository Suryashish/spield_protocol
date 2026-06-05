import { createContext, useContext } from 'react';

/**
 * Lets any nested dashboard panel switch the active section without prop-drilling
 * the setter down through `DashboardPage → SECTIONS[id]() → panel`. `DashboardPage`
 * provides the current section id + a `navigate` setter; panels (e.g. the Deposit and
 * Fixed-Vault cross-links) consume `navigate(id)` to jump between the two doors to the
 * protocol.
 */
type NavContextValue = {
  /** The currently-active section id. */
  active: string;
  /** Switch to another section by its nav id (e.g. 'vault', 'deposit'). */
  navigate: (id: string) => void;
};

const NavContext = createContext<NavContextValue | undefined>(undefined);

export const NavProvider = NavContext.Provider;

export const useNav = (): NavContextValue => {
  const ctx = useContext(NavContext);
  if (!ctx) {
    throw new Error('useNav must be used within a <NavProvider>.');
  }
  return ctx;
};
