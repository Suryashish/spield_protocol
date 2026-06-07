//! # spield-shared::ttl — maturity-aware persistent-storage TTL bumps
//!
//! Soroban persistent entries are **archived** when their TTL lapses, and an archived position is
//! unrecoverable without an off-chain restore. Spield's products are **multi-month** (a PT bond
//! matures on a fixed future date), but a flat "~60 day" bump can lapse *before* maturity — so a
//! position that is simply held (never claimed/written) past the bump window would archive. This is
//! the bond-specific TTL risk (mainnet-readiness #5).
//!
//! The fix: bump every per-position / per-receipt entry by **`maturity - now + buffer`**, not a flat
//! window — so an entry lives at least until its market matures plus a grace period for the holder to
//! redeem. We clamp to the network's `max_live_until_ledger()` (the protocol caps how far any TTL can
//! be pushed) so the call can never fail for asking too much. When the desired lifetime exceeds that
//! ceiling (a bond longer than the network max-TTL, ~the cap is months), the entry is bumped to the
//! ceiling and a **permissionless `bump_*` entry point** lets anyone top it up again later, keeping
//! long-dated positions alive across the whole bond term.
//!
//! All durations are in **ledgers** (Soroban's TTL unit); we convert seconds at the ~5s close time.

use soroban_sdk::Env;

/// Average ledger close time (seconds). Stellar targets ~5s; used to convert a wall-clock duration
/// into a ledger count for TTL math. A small error here is harmless — it only shifts the bump target
/// slightly, and the value is re-bumped on every write and by the permissionless `bump_*` calls.
pub const SECS_PER_LEDGER: u64 = 5;

/// A grace buffer (in seconds) added on top of `maturity` so an entry stays live for a while *after*
/// the market matures — long enough for the holder to come back and redeem without the entry having
/// archived. 30 days.
pub const POST_MATURITY_GRACE_SECS: u64 = 30 * 24 * 60 * 60;

/// A sensible floor for the bump window (in ledgers) so that even at/after maturity (when
/// `maturity - now` is zero or negative) entries still get a healthy extension — the grace alone
/// already covers this, but we also never bump by *less* than ~30 days of ledgers.
pub const MIN_BUMP_LEDGERS: u32 = (30 * 24 * 60 * 60 / SECS_PER_LEDGER) as u32;

/// Compute the `(threshold, extend_to)` pair for `extend_ttl` so that a per-position/receipt entry
/// lives until at least `maturity + grace`, clamped to the network's max allowed TTL.
///
/// * `threshold` — we always re-extend (return `0`) so every touch refreshes the lifetime; cheap and
///   keeps the logic simple (the host no-ops if the entry is already past the target anyway).
/// * `extend_to` — ledgers from *now* to keep the entry live. Computed as
///   `(maturity + grace - now)/SECS_PER_LEDGER`, floored at `MIN_BUMP_LEDGERS`, and capped so the
///   resulting live-until ledger never exceeds `env.ledger().max_live_until_ledger()`.
///
/// Returns `(threshold_ledgers, extend_to_ledgers)`.
pub fn maturity_aware_bump(env: &Env, maturity: u64) -> (u32, u32) {
    let now = env.ledger().timestamp();
    let seq = env.ledger().sequence();
    let max_live_until = env.ledger().max_live_until_ledger();

    // Desired remaining lifetime in seconds: until maturity + grace (never negative).
    let secs_until_target = maturity
        .saturating_add(POST_MATURITY_GRACE_SECS)
        .saturating_sub(now);
    // Convert to ledgers, floored at the minimum window.
    let mut extend_to = (secs_until_target / SECS_PER_LEDGER) as u32;
    if extend_to < MIN_BUMP_LEDGERS {
        extend_to = MIN_BUMP_LEDGERS;
    }

    // Clamp so `seq + extend_to` never exceeds the network's max live-until ledger (extend_ttl would
    // otherwise be asking beyond the protocol cap). `max_live_until` is an absolute ledger number.
    let max_extend = max_live_until.saturating_sub(seq);
    if extend_to > max_extend {
        extend_to = max_extend;
    }

    // Re-extend on every call: threshold 0 means "always bump to extend_to".
    (0, extend_to)
}
