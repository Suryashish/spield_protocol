import { createContext, useCallback, useContext, useMemo, useState } from 'react';
import type { ReactNode } from 'react';

import ShareCardDialog from '@/components/dashboard/share/ShareCardDialog';
import type { ShareCard } from '@/lib/shareCard';

type ShareCardContextValue = {
  /** Open the share dialog on `card`. */
  share: (card: ShareCard) => void;
};

const ShareCardContext = createContext<ShareCardContextValue | undefined>(undefined);

/**
 * Owns the one share dialog in the app.
 *
 * It sits ABOVE the toast provider on purpose. The offer to share arrives on a success toast, and a
 * toast dismisses itself after a few seconds; a dialog that lived inside it would close under the
 * user while they were still choosing a format.
 */
export const ShareCardProvider = ({ children }: { children: ReactNode }) => {
  const [card, setCard] = useState<ShareCard | null>(null);
  const share = useCallback((c: ShareCard) => setCard(c), []);
  const close = useCallback(() => setCard(null), []);
  const value = useMemo(() => ({ share }), [share]);

  return (
    <ShareCardContext.Provider value={value}>
      {children}
      <ShareCardDialog card={card} onClose={close} />
    </ShareCardContext.Provider>
  );
};

export const useShareCard = (): ShareCardContextValue => {
  const ctx = useContext(ShareCardContext);
  if (!ctx) {
    throw new Error('useShareCard must be used within a <ShareCardProvider>.');
  }
  return ctx;
};
