import { Moon, Sun } from 'lucide-react';

import { cn } from '@/lib/utils';
import { useTheme } from '@/lib/theme';

/**
 * The theme switch — same mark, same shape and same place as the one on
 * www.spield.live: a hairline circle that lifts a pixel on hover.
 *
 * Both glyphs are rendered and one is hidden by CSS rather than swapped on
 * state, so the button never changes size between themes and there is nothing
 * to lay out mid-transition.
 */
const ThemeToggle = ({ className }: { className?: string }) => {
  const { theme, toggle } = useTheme();
  const dark = theme === 'dark';

  return (
    <button
      type="button"
      onClick={toggle}
      aria-label={dark ? 'Switch to light theme' : 'Switch to dark theme'}
      title={dark ? 'Light theme' : 'Dark theme'}
      className={cn(
        'grid size-9 shrink-0 place-items-center rounded-full border border-border bg-card text-muted-foreground shadow-float-sm',
        'transition-all duration-200 ease-vault hover:-translate-y-px hover:border-line-strong hover:text-foreground',
        className,
      )}
    >
      {dark ? <Moon size={15} /> : <Sun size={15} />}
    </button>
  );
};

export default ThemeToggle;
