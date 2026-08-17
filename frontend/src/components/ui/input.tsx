import * as React from "react"

import { cn } from "@/lib/utils"

function Input({ className, type, ...props }: React.ComponentProps<"input">) {
  return (
    <input
      type={type}
      data-slot="input"
      className={cn(
        // A field is somewhere you type, so it is folded INTO the card rather
        // than raised off it: the sunken step, a hairline, and an inset
        // contact shadow. Figures are tabular so a number doesn't shuffle
        // sideways as you key it in.
        //
        // Spelled out in utilities rather than borrowing `.well`, because
        // some callers cancel the chrome with `border-none bg-transparent`
        // — those cancels can beat a utility, but not a hand-written class.
        //
        // Note there is no `md:text-sm` here any more. It used to sit at the
        // end of this string, and a responsive variant beats an unprefixed
        // utility whatever tailwind-merge does with the class list — so every
        // caller that passed its own `text-[…]` silently rendered at 14px on
        // desktop. The base size is now unconditional and callers win.
        // Amount inputs don't come through here at all: see `AmountField`.
        "num h-10 w-full min-w-0 rounded-lg border border-border bg-sunken px-3 py-2 text-sm shadow-[inset_0_1px_2px_rgb(18_18_18/0.04)] transition-colors outline-none file:inline-flex file:h-6 file:border-0 file:bg-transparent file:text-sm file:font-medium file:text-foreground placeholder:text-subtle focus-visible:border-brand/50 disabled:pointer-events-none disabled:cursor-not-allowed disabled:opacity-50 aria-invalid:border-destructive aria-invalid:ring-3 aria-invalid:ring-destructive/20",
        className
      )}
      {...props}
    />
  )
}

export { Input }
