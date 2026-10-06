import { useEffect, useState } from 'react';
import { Dialog as DialogPrimitive } from 'radix-ui';
import { Copy, Download, Loader2, Send, Share2, X } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import {
  SHARE_FORMATS,
  renderShareCard,
  shareFileName,
  xIntentUrl,
  type ShareCard,
  type ShareFormat,
  type ShareImage,
} from '@/lib/shareCard';

const FORMATS = Object.keys(SHARE_FORMATS) as ShareFormat[];

type Drawn = { status: 'ready'; image: ShareImage; url: string } | { status: 'failed' };

/**
 * The share dialog: a card for the thing that just happened, in the shape of wherever it is going.
 *
 * Three ways out, because no single one works everywhere. The system share sheet is the only route
 * into Instagram and it exists on phones; a download works on everything; and X takes prefilled
 * text but will not accept an image by URL, so "Post on X" puts the card on the clipboard and
 * opens the composer for it to be pasted into.
 *
 * The preview is an `<img>` rather than the canvas itself so that a long-press on a phone offers
 * "Save image", which is how most people expect to keep a picture.
 */
const ShareCardDialog = ({ card, onClose }: { card: ShareCard | null; onClose: () => void }) => {
  const [format, setFormat] = useState<ShareFormat>('wide');
  const [drawn, setDrawn] = useState<Drawn | null>(null);
  const [note, setNote] = useState<string | null>(null);

  // Draw whenever the card or the shape changes. The cleanup clears the previous picture, so
  // `drawn` only ever describes what is on screen, and a slow render can never land on the wrong one.
  useEffect(() => {
    if (!card) return;
    let live = true;
    let url: string | null = null;
    renderShareCard(card, format).then(
      (image) => {
        if (!live) return;
        url = URL.createObjectURL(image.file);
        setDrawn({ status: 'ready', image, url });
      },
      () => {
        if (live) setDrawn({ status: 'failed' });
      },
    );
    return () => {
      live = false;
      if (url) URL.revokeObjectURL(url);
      setDrawn(null);
    };
  }, [card, format]);

  const ready = drawn?.status === 'ready' ? drawn : null;
  const file =
    ready && card ? new File([ready.image.file], shareFileName(card), { type: 'image/jpeg' }) : null;

  const canShareFile =
    !!file && typeof navigator.canShare === 'function' && navigator.canShare({ files: [file] });
  const canCopy =
    typeof ClipboardItem !== 'undefined' && typeof navigator.clipboard?.write === 'function';
  // On a phone the share sheet is the way to Instagram, so it leads. On a desktop a file does.
  const shareLeads = canShareFile && navigator.maxTouchPoints > 0;

  const download = () => {
    if (!ready || !card) return;
    const a = document.createElement('a');
    a.href = ready.url;
    a.download = shareFileName(card);
    a.click();
  };

  const copy = async (): Promise<boolean> => {
    if (!ready || !canCopy) return false;
    try {
      await navigator.clipboard.write([new ClipboardItem({ 'image/png': ready.image.clip })]);
      return true;
    } catch {
      return false;
    }
  };

  const onDownload = () => {
    download();
    setNote('Saved to your downloads.');
  };

  const onCopy = async () => {
    setNote((await copy()) ? 'Image copied. Paste it anywhere.' : 'Copying is blocked here. Use Download.');
  };

  const onShare = async () => {
    if (!file || !card) return;
    try {
      await navigator.share({ files: [file], text: card.text });
    } catch (err) {
      // Dismissing the sheet is a choice, not a failure.
      if ((err as DOMException | undefined)?.name !== 'AbortError') {
        setNote('Sharing is blocked here. Use Download.');
      }
    }
  };

  // Runs on the link's own click and lets the navigation go ahead. The copy has to START before the
  // composer takes focus: a clipboard write from a background tab is refused.
  const onPost = () => {
    if (canCopy) {
      void copy().then((ok) =>
        setNote(
          ok
            ? 'Image copied. Paste it into your post.'
            : 'Download the image and attach it to your post.',
        ),
      );
    } else {
      download();
      setNote('Image saved. Attach it to your post.');
    }
  };

  return (
    <DialogPrimitive.Root
      open={card !== null}
      onOpenChange={(open) => {
        if (open) return;
        setNote(null);
        onClose();
      }}
    >
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className="fixed inset-0 z-50 bg-stage/55 backdrop-blur-sm data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=open]:fade-in-0 data-[state=closed]:fade-out-0" />
        <DialogPrimitive.Content className="app-shell panel fixed left-1/2 top-1/2 z-50 max-h-[calc(100dvh-2rem)] w-[calc(100%-2rem)] max-w-lg -translate-x-1/2 -translate-y-1/2 overflow-y-auto rounded-2xl p-5 shadow-lift data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=open]:zoom-in-95">
          <div className="flex items-start justify-between">
            <div>
              <DialogPrimitive.Title className="font-display text-[16px] font-medium tracking-[-0.02em]">
                Share your card
              </DialogPrimitive.Title>
              <DialogPrimitive.Description className="mt-1 text-[12.5px] text-muted-foreground">
                A ready-made image of what you just did. Post it anywhere.
              </DialogPrimitive.Description>
            </div>
            <DialogPrimitive.Close
              aria-label="Close"
              className="-mr-1 -mt-1 grid size-7 place-items-center rounded-full text-subtle transition-colors duration-200 hover:bg-accent hover:text-foreground"
            >
              <X size={16} />
            </DialogPrimitive.Close>
          </div>

          <div className="mt-4 grid grid-cols-3 gap-1 rounded-lg bg-muted/50 p-1">
            {FORMATS.map((f) => (
              <button
                key={f}
                type="button"
                aria-pressed={format === f}
                onClick={() => {
                  setFormat(f);
                  setNote(null);
                }}
                className={cn(
                  'rounded-md px-2 py-1.5 text-xs font-medium transition',
                  format === f
                    ? 'bg-background text-foreground shadow-sm'
                    : 'text-muted-foreground hover:text-foreground',
                )}
              >
                <span className="block">{SHARE_FORMATS[f].label}</span>
                <span className="block text-[10px] opacity-70">{SHARE_FORMATS[f].hint}</span>
              </button>
            ))}
          </div>

          {/* A fixed-height frame, so switching between a landscape card and a story does not
              resize the dialog under the pointer. Flex, not grid: a percentage max-height on a grid
              item resolves against an auto-sized row, which is no limit at all, and the story card
              ran straight out of the frame and under the buttons. */}
          <div className="well mt-3 flex h-[min(46dvh,340px)] items-center justify-center rounded-xl p-3">
            {ready && card ? (
              <img
                src={ready.url}
                alt={`${card.eyebrow}: ${card.figure}${card.unit ? ` ${card.unit}` : ''}${card.flourish ? ` ${card.flourish}` : ''}. ${card.stats.map((s) => `${s.label} ${s.value}`).join(', ')}.`}
                className="max-h-full max-w-full rounded-lg object-contain shadow-lift"
              />
            ) : drawn?.status === 'failed' ? (
              <p className="max-w-[26ch] text-center text-[12.5px] text-muted-foreground">
                This browser could not draw the card. Your transaction is unaffected.
              </p>
            ) : (
              <Loader2 size={18} className="animate-spin text-muted-foreground" aria-label="Drawing the card" />
            )}
          </div>

          <div className="mt-4 flex flex-wrap gap-2">
            {canShareFile && (
              <Button
                variant={shareLeads ? 'default' : 'outline'}
                className={cn('h-10 min-w-[7.5rem] flex-1 text-[13.5px]', !shareLeads && 'order-last')}
                onClick={onShare}
              >
                <Share2 size={15} />
                Share
              </Button>
            )}
            <Button
              variant={shareLeads ? 'outline' : 'default'}
              className="h-10 min-w-[7.5rem] flex-1 text-[13.5px]"
              disabled={!ready}
              onClick={onDownload}
            >
              <Download size={15} />
              Download
            </Button>
            {canCopy && (
              <Button
                variant="outline"
                className="h-10 min-w-[7.5rem] flex-1 text-[13.5px]"
                disabled={!ready}
                onClick={onCopy}
              >
                <Copy size={15} />
                Copy image
              </Button>
            )}
            <Button
              asChild
              variant="outline"
              className={cn(
                'h-10 min-w-[7.5rem] flex-1 text-[13.5px]',
                !ready && 'pointer-events-none opacity-50',
              )}
            >
              <a
                href={card ? xIntentUrl(card) : undefined}
                target="_blank"
                rel="noreferrer noopener"
                aria-disabled={!ready}
                onClick={onPost}
              >
                <Send size={15} />
                Post on X
              </a>
            </Button>
          </div>

          {/* One line that is always there, so a status arriving does not push the buttons. Until
              something happens it answers the question a person has before posting a picture of
              their money. */}
          <p
            role="status"
            className={cn(
              'mt-3 text-center text-[12.5px]',
              note ? 'text-brand-text' : 'text-muted-foreground',
            )}
          >
            {note ?? 'Shows your amounts, never your wallet address.'}
          </p>
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
};

export default ShareCardDialog;
