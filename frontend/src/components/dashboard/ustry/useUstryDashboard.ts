import { useCallback, useEffect, useRef, useState } from 'react';
import { useSeries } from '@/context/SeriesContext';
import { useWallet } from '@/context/WalletContext';
import { useToast } from '@/context/ToastContext';
import { addr, i128, writeContract } from '@/lib/soroban';
import {
  readUstry,
  ustryContracts,
  writeUstry,
  entitlement,
  formatUstrySimulationError,
  type UstrySnapshot,
} from '@/lib/ustry';
const errorText = (error: unknown) =>
  error instanceof Error ? error.message : 'Could not complete the request.';
type Activity = { hash: string; label: string; time: number };
export function useUstryDashboard() {
  const { activeSeries } = useSeries();
  const { address, onCorrectNetwork, openWalletPicker, connecting } = useWallet();
  const { push, update } = useToast();
  const c = ustryContracts(activeSeries);
  const [data, setData] = useState<UstrySnapshot | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [clock, setClock] = useState(() => Date.now());
  const [activity, setActivity] = useState<Activity[]>(() => {
    try {
      const saved = JSON.parse(
        localStorage.getItem(`spield.ustry.activity.${activeSeries.id}.${address ?? 'none'}`) ??
          '[]',
      );
      return Array.isArray(saved)
        ? saved
            .filter(
              (a) =>
                typeof a?.hash === 'string' &&
                /^[a-f0-9]{64}$/.test(a.hash) &&
                typeof a.label === 'string' &&
                typeof a.time === 'number',
            )
            .slice(0, 20)
        : [];
    } catch {
      return [];
    }
  });
  const request = useRef(0);
  const mounted = useRef(true);
  const activityKey = `spield.ustry.activity.${activeSeries.id}.${address ?? 'none'}`;
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  const refresh = useCallback(async () => {
    const id = ++request.current;
    setLoading(true);
    try {
      const next = await readUstry(activeSeries, address);
      if (mounted.current && id === request.current) {
        setData(next);
        setError(null);
      }
    } catch (e) {
      if (mounted.current && id === request.current) setError(errorText(e));
    } finally {
      if (mounted.current && id === request.current) setLoading(false);
    }
  }, [activeSeries, address]);
  useEffect(() => {
    let active = true;
    queueMicrotask(() => {
      if (active) void refresh();
    });
    const timer = setInterval(() => {
      if (document.visibilityState === 'visible') void refresh();
    }, 30_000);
    return () => {
      active = false;
      clearInterval(timer);
    };
  }, [refresh]);
  useEffect(() => {
    const timer = setInterval(() => setClock(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);
  const matured = clock / 1000 >= activeSeries.expiry;
  const stale =
    !!data &&
    (Number(data.latest.timestamp) > clock / 1000 + 30 ||
      clock / 1000 - Number(data.latest.timestamp) > c.maxAge);
  const unsafe = !data || !!error || !!data.syncError || (stale && !data.state.finalized);
  const entryBlocked =
    unsafe || matured || !!data?.paused || (!!data && data.latest.price < data.state.high_water);
  const claimable = data ? entitlement(data.holding, data.state) : 0n;
  const walletReady = !!address && onCorrectNetwork;
  const record = (item: Activity) => {
    if (!mounted.current) return;
    setActivity((old) => {
      const next = [item, ...old].slice(0, 20);
      try {
        localStorage.setItem(activityKey, JSON.stringify(next));
      } catch {
        /* optional */
      }
      return next;
    });
  };
  async function run(label: string, fn: () => Promise<{ hash: string }>) {
    if (!walletReady || busy) return false;
    setBusy(true);
    const id = push({ kind: 'pending', title: label, message: 'Confirm in your wallet…' });
    try {
      const result = await fn();
      record({ hash: result.hash, label, time: clock });
      update(id, { kind: 'success', title: label + ' confirmed', hash: result.hash });
      if (mounted.current) {
        await refresh();
      }
      return true;
    } catch (e) {
      update(id, { kind: 'error', title: label + ' failed', message: errorText(e) });
      return false;
    } finally {
      if (mounted.current) setBusy(false);
    }
  }
  async function transact(label: string, method: string, amount?: bigint, minimum = 0n) {
    if (!address) return false;
    return run(label, () => writeUstry(activeSeries, address, method, amount, minimum));
  }
  async function transfer(token: 'receipt' | 'pt' | 'yt', recipient: string, amount: bigint) {
    if (!address) return false;
    return run('Transfer ' + token, () =>
      writeContract(
        address,
        c[token],
        'transfer',
        [addr(address), addr(recipient), i128(amount)],
        formatUstrySimulationError,
      ),
    );
  }
  async function finalize() {
    if (!address) return false;
    return run('Finalize USTRY series', () =>
      writeContract(address, c.series, 'finalize', [], formatUstrySimulationError),
    );
  }
  async function onConverted(hash: string) {
    record({ hash, label: 'USDC / USTRY conversion', time: clock });
    await refresh();
  }
  return {
    activeSeries,
    c,
    address,
    onCorrectNetwork,
    openWalletPicker,
    connecting,
    data,
    error,
    loading,
    busy,
    clock,
    matured,
    stale,
    unsafe,
    entryBlocked,
    claimable,
    activity,
    refresh,
    transact,
    transfer,
    finalize,
    onConverted,
  };
}
export type UstryDashboardModel = ReturnType<typeof useUstryDashboard>;
