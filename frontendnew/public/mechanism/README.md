# Mechanism section — card footage

Drop the three videos here and they play automatically, in view, muted and
looping. No code change needed — the paths are already wired in
`components/SplitSection.tsx` (`STEPS[].video`).

| file            | card              | accent            |
| --------------- | ----------------- | ----------------- |
| `01-deposit.mp4`| 01 · Deposit      | USDC blue `--usdc`|
| `02-split.mp4`  | 02 · Split        | green `--accent`  |
| `03-choose.mp4` | 03 · Choose       | ember `--ember`   |

Frame is `4 / 3` on desktop, `16 / 10` below 900px, and the footage is
`object-cover` — keep the subject centred so neither crop loses it.

Until a file exists the card falls back to its own lit placeholder (the ghost
numeral), so a missing video never reads as broken. A poster frame is optional:
add `poster: "/mechanism/01-deposit.jpg"` to the step.
