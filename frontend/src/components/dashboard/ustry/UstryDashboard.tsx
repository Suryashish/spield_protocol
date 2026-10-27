import { useCallback, useEffect, useRef, useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { RefreshCw, Landmark, ArrowUpRight } from 'lucide-react';
import { useSeries } from '@/context/SeriesContext';
import { useWallet } from '@/context/WalletContext';
import { useToast } from '@/context/ToastContext';
import { explorerTx } from '@/lib/config';
import { addr, i128, writeContract } from '@/lib/soroban';
import { FACTOR_SCALE, entitlement, quantity, readUstry, units, ustryContracts, writeUstry, type UstrySnapshot } from '@/lib/ustry';
import Header from '../layout/Header';
import UstryConversion from './UstryConversion';

const links = [['overview','Overview'],['deposit','Deposit / redeem'],['v2','Yield'],['srwrap','Receipts'],['markets','Convert USDC'],['solvency','Backing'],['activity','Activity']];
const panel='rounded-2xl border border-border bg-card p-5 shadow-float-sm';
const input='w-full rounded-xl border border-border bg-canvas px-3 py-2 text-sm';
const button='rounded-full border border-border bg-brand px-4 py-2 text-sm text-foreground disabled:opacity-40 disabled:cursor-not-allowed';
const errorText=(error:unknown)=>error instanceof Error ? error.message : 'Could not complete the request.';
type Activity={hash:string;label:string;time:number};

export default function UstryDashboard() {
  const {activeSeries}=useSeries(); const {address,onCorrectNetwork,openWalletPicker}=useWallet();
  const {push,update}=useToast(); const location=useLocation(); const c=ustryContracts(activeSeries);
  const current=location.pathname.split('/').at(-1) ?? 'overview';
  const section=links.some(([id])=>id===current) ? current : 'unsupported';
  const [data,setData]=useState<UstrySnapshot|null>(null); const [error,setError]=useState<string|null>(null);
  const [loading,setLoading]=useState(true); const [busy,setBusy]=useState(false); const [clock,setClock]=useState(Date.now());
  const [amount,setAmount]=useState(''); const [mode,setMode]=useState('deposit_split');
  const [token,setToken]=useState<'receipt'|'pt'|'yt'>('pt'); const [recipient,setRecipient]=useState('');
  const [activity,setActivity]=useState<Activity[]>([]); const request=useRef(0); const mounted=useRef(true);
  const activityKey=`spield.ustry.activity.${activeSeries.id}.${address ?? 'none'}`;
  useEffect(()=>{ mounted.current=true;return()=>{mounted.current=false;request.current++;}; },[]);
  useEffect(()=>{setData(null);setAmount('');setRecipient('');setError(null);setActivity([]);
    try { const saved=JSON.parse(localStorage.getItem(activityKey) ?? '[]'); if(Array.isArray(saved)) setActivity(saved.slice(0,20)); } catch { /* optional device history */ }
  },[address,activityKey]);
  const refresh=useCallback(async()=>{
    const id=++request.current; setLoading(true);
    try { const next=await readUstry(activeSeries,address); if(mounted.current && id===request.current){setData(next);setError(null);} }
    catch(e){ if(mounted.current && id===request.current) setError(errorText(e)); }
    finally { if(mounted.current && id===request.current)setLoading(false); }
  },[activeSeries,address]);
  useEffect(()=>{void refresh(); const timer=setInterval(()=>{if(document.visibilityState==='visible') void refresh();},30_000);return()=>{clearInterval(timer);request.current++;};},[refresh]);
  useEffect(()=>{const timer=setInterval(()=>setClock(Date.now()),1000);return()=>clearInterval(timer);},[]);
  const matured=clock/1000>=activeSeries.expiry;
  const stale=!!data && (Number(data.latest.timestamp)>clock/1000+30 || clock/1000-Number(data.latest.timestamp)>c.maxAge);
  const unsafe=!data || !!error || !!data.syncError || stale;
  const entryBlocked=unsafe || matured || !!data?.paused || (!!data && data.latest.price<data.state.high_water);
  const walletReady=!!address && onCorrectNetwork;
  let entered=0n;try{entered=quantity(amount);}catch{/* invalid input handled below */}
  const face=data ? entered*FACTOR_SCALE/data.state.factor : 0n;
  const payout=data ? entered*data.state.factor/FACTOR_SCALE : 0n;
  const actionBlocked=mode==='withdraw_receipts' ? !data || !!error || entered>data.holding.receipt : mode==='redeem' ? unsafe || entered>(data?.holding.pt ?? 0n) || (!matured && entered>(data?.holding.yt ?? 0n)) : entryBlocked || (mode==='split' ? entered>(data?.holding.receipt ?? 0n) : entered>(data?.wallet ?? 0n));
  const record=(item:Activity)=>{if(!mounted.current)return;setActivity(old=>{const next=[item,...old].slice(0,20);try{localStorage.setItem(activityKey,JSON.stringify(next));}catch{/* optional */}return next;});};
  async function run(label:string,fn:()=>Promise<{hash:string}>) {
    if(!walletReady || busy)return;setBusy(true);const id=push({kind:'pending',title:label,message:'Confirm in your wallet…'});
    try{const result=await fn();record({hash:result.hash,label,time:Date.now()});update(id,{kind:'success',title:label+' confirmed',hash:result.hash});if(mounted.current){setAmount('');await refresh();}}
    catch(e){update(id,{kind:'error',title:label+' failed',message:errorText(e)});}
    finally{if(mounted.current)setBusy(false);}
  }
  const execute=()=>{
    if(!address || entered<=0n)return;
    const minimum=(mode==='redeem' ? payout : face)*9950n/10000n;
    void run(mode==='deposit_split'?'Deposit and split USTRY':mode.replaceAll('_',' '),()=>writeUstry(activeSeries,address,mode,entered,minimum>0n?minimum:1n));
  };
  const holding=data?.holding;
  return <div className="flex h-screen min-w-0 flex-col bg-canvas text-foreground">
    <Header section="USTRY" />
    <div className="flex min-h-0 flex-1 flex-col lg:flex-row">
      <nav aria-label="USTRY navigation" className="flex shrink-0 gap-2 overflow-x-auto border-b border-border p-3 lg:w-52 lg:flex-col lg:border-r lg:border-b-0">
        {links.map(([id,label])=><Link key={id} to={`/${id}`} className={`whitespace-nowrap rounded-xl px-3 py-2 text-sm ${section===id?'bg-brand/15 text-brand-text':'hover:bg-accent'}`}>{label}</Link>)}
        <span className="hidden px-3 pt-4 text-xs text-muted-foreground lg:block">Stellar testnet<br/>Etherfuse sandbox</span>
      </nav>
      <main className="min-w-0 flex-1 space-y-5 overflow-y-auto p-4 sm:p-6 lg:p-8">
        <div className="mx-auto max-w-5xl space-y-5">
          <div className="flex flex-wrap items-start justify-between gap-3"><div><h1 className="flex items-center gap-2 text-2xl font-bold"><Landmark size={25}/>USTRY · {links.find(([id])=>id===section)?.[1] ?? 'Unavailable feature'}</h1><p className="mt-2 text-sm text-muted-foreground">{activeSeries.name} · Matures {new Date(activeSeries.expiry*1000).toLocaleString()} · Test tokens</p></div><button className={button} disabled={loading||busy} onClick={()=>void refresh()}><RefreshCw size={14} className={`mr-2 inline ${loading?'animate-spin':''}`}/>Refresh</button></div>
          <p className="rounded-xl border border-border bg-accent/30 p-3 text-sm">Deposits and payouts use USTRY. PT and YT use USD face units. NAV can fall; PT does not guarantee a dollar payout. Fiat redemption is handled by Spield’s registered Etherfuse account.</p>
          {!address && <button className={button} onClick={openWalletPicker}>Connect wallet to use USTRY</button>}
          {address&&!onCorrectNetwork&&<p role="alert" className="text-danger-text">Switch your wallet to Stellar testnet.</p>}
          {loading&&!data&&<p role="status">Loading the USTRY series…</p>}
          {error&&<p role="alert" className="rounded-xl border border-danger/40 p-3 text-danger-text">USTRY reads failed: {error} Your balances have not been assumed to be zero. Refresh to retry.</p>}
          {(stale||data?.syncError)&&<p role="alert" className="rounded-xl border border-danger/40 p-3 text-danger-text">{matured?'Maturity settlement is pending a valid boundary observation.':'NAV is stale or synchronization is unavailable.'} Priced actions are disabled. Unsplit receipts can still be withdrawn in kind. {data?.syncError}</p>}
          {data?.paused&&<p role="status">New deposits and splits are paused. Existing exits remain available when their price requirements are met.</p>}
          {data&&<div className={`grid gap-3 sm:grid-cols-2 lg:grid-cols-4 ${error?'opacity-50':''}`}>
            {[['Sandbox NAV',`$${units(data.latest.price,8)} / USTRY`],['Wallet USTRY',address?units(data.wallet):'Connect wallet'],['PT · USD face',address?units(data.holding.pt):'—'],['YT · USD face',address?units(data.holding.yt):'—']].map(([label,value])=><div key={label} className={panel}><p className="text-xs text-muted-foreground">{label}</p><p className="mt-2 break-all text-lg font-semibold">{value}</p></div>)}
          </div>}
          {section==='overview'&&<div className={panel}><h2 className="text-lg font-semibold">Treasury yield, with an in-kind exit</h2><ol className="mt-3 list-inside list-decimal space-y-2 text-sm"><li>Acquire sandbox USTRY or convert supported test USDC.</li><li>Deposit USTRY and split into equal PT and YT dollar face.</li><li>Claim YT earnings in USTRY as the NAV high-water mark increases.</li><li>Before maturity, recombine matching PT and YT. After settlement, redeem PT alone.</li></ol><p className="mt-4 text-sm text-muted-foreground">Yield is variable. Recovery below the previous NAV high creates no new yield. New splits pause during a drawdown. This series has no PT trading pool or fixed-rate vault.</p><Link className="mt-4 inline-block text-brand-text" to="/deposit">Deposit / redeem →</Link></div>}
          {(section==='deposit'||section==='srwrap')&&<div className={panel}><h2 className="text-lg font-semibold">{section==='srwrap'?'Unsplit USTRY receipts':'Deposit, split or redeem'}</h2><p className="my-3 text-sm text-muted-foreground">Receipt balance: {holding?units(holding.receipt):'—'} sUSTRY. One unsplit receipt withdraws one USTRY. Receipts do not have the Blend SR exchange rate.</p><div className="grid max-w-xl gap-3">
            <label className="text-sm">Action<select aria-label="USTRY action" className={input} value={mode} onChange={e=>{setMode(e.target.value);setAmount('');}}><option value="deposit_split">Deposit USTRY + split into PT/YT</option><option value="deposit">Deposit USTRY as receipts</option><option value="split">Split existing receipts</option><option value="withdraw_receipts">Withdraw unsplit receipts</option><option value="redeem">{matured?'Redeem matured PT':'Recombine PT + YT'}</option></select></label>
            <label className="text-sm">Amount · {mode==='redeem'?'USD face (PT)':mode==='split'||mode==='withdraw_receipts'?'sUSTRY receipts':'USTRY'}<input aria-label="USTRY amount" className={input} inputMode="decimal" value={amount} onChange={e=>setAmount(e.target.value)} placeholder="0.0"/></label>
            {entered>0n&&data&&<p className="text-sm">{mode==='redeem'?`Estimated payout: ${units(payout)} USTRY`:(mode==='split'||mode==='deposit_split')?`Receive about ${units(face)} PT and ${units(face)} YT (USD face)`:`${units(entered)} USTRY ↔ ${units(entered)} receipts`}. Priced actions include a 0.5% minimum-output tolerance; the wallet shows the exact minimum.</p>}
            <button className={button} disabled={!walletReady||busy||loading||entered<=0n||actionBlocked} onClick={execute}>{busy?'Confirming…':'Review in wallet'}</button>
            {entryBlocked&&!matured&&data&&!unsafe&&data.latest.price<data.state.high_water&&<p className="text-sm text-danger-text">NAV is below the high-water mark. New splits are temporarily unavailable.</p>}
          </div></div>}
          {section==='v2'&&<div className={panel}><h2 className="text-lg font-semibold">Your yield</h2><p className="my-3">Claimable: {data?units(entitlement(data.holding,data.state)):'—'} USTRY</p><p className="mb-4 text-sm text-muted-foreground">Claims settle previously earned token units. Selling or transferring YT keeps prior earnings with the previous owner. No new yield accrues after maturity.</p><button className={button} disabled={!walletReady||busy||loading||unsafe||!data||entitlement(data.holding,data.state)<=0n} onClick={()=>address&&void run('Claim USTRY yield',()=>writeUstry(activeSeries,address,'claim_yield'))}>Claim yield in USTRY</button></div>}
          {['deposit','srwrap','v2'].includes(section)&&<details className={panel}><summary className="cursor-pointer font-medium">Transfer receipt / PT / YT</summary><div className="mt-4 grid max-w-xl gap-3"><label>Token<select aria-label="Transfer token" className={input} value={token} onChange={e=>setToken(e.target.value as typeof token)}><option value="receipt">sUSTRY receipt</option><option value="pt">PT-USTRY</option><option value="yt">YT-USTRY</option></select></label><label>Recipient Stellar address<input className={input} aria-label="Token recipient" value={recipient} onChange={e=>setRecipient(e.target.value.trim())}/></label><label>Amount · {token==='receipt'?'receipts':'USD face'}<input className={input} aria-label="Transfer amount" inputMode="decimal" value={amount} onChange={e=>setAmount(e.target.value)}/></label><button className={button} disabled={!walletReady||busy||loading||entered<=0n||!recipient||!!error||(token==='yt'&&unsafe)} onClick={()=>address&&void run('Transfer '+token,()=>writeContract(address,c[token],'transfer',[addr(address),addr(recipient),i128(entered)]))}>Review transfer</button></div></details>}
          {section==='markets'&&<UstryConversion busyParent={busy} onConfirmed={async hash=>{record({hash,label:'USDC / USTRY conversion',time:Date.now()});await refresh();}}/>}
          {section==='solvency'&&<div className={panel}><h2 className="text-lg font-semibold">Custody and series configuration</h2><dl className="my-4 grid gap-2 text-sm"><div>USTRY in custody: {data?units(data.custody):'—'}</div><div>Unsplit receipts outstanding: {data?units(data.state.receipts):'—'}</div><div>PT/YT token backing: {data?units(data.state.backing):'—'} USTRY</div><div>Coverage: {data?(data.custody>=data.state.receipts+data.state.backing?'Covered in token units':'DEFICIT — stop deposits'):'Unknown'}</div><div>Deposit cap: {c.capUstry} USTRY</div><div>Settlement: {data?.state.finalized?'Finalized':matured?'Pending boundary observation':'Not yet matured'}</div><div>Oracle: Etherfuse sandbox NAV, relayed; USD / USTRY, 8 decimals</div><div>Last relay observation: {data?new Date(Number(data.latest.timestamp)*1000).toLocaleString():'—'}</div><div>Freshness limit: 13 hours; relay heartbeat 12 hours or 0.1% NAV move</div></dl><p className="mb-4 text-sm text-muted-foreground">The relay timestamp records when the service observed the quote, not the underlying Treasury valuation effective time. Issuer freezes/clawback, stale prices, missing maturity history and limited exchange liquidity can delay exits. Token coverage does not guarantee dollar principal or fiat redemption.</p>{Object.entries(c).filter(([,value])=>typeof value==='string').map(([label,value])=><p key={label} className="my-2 break-all text-xs"><span className="font-semibold">{label}: </span><a className="text-brand-text" target="_blank" rel="noreferrer" href={`https://stellar.expert/explorer/testnet/contract/${value}`}>{value}<ArrowUpRight className="inline" size={12}/></a></p>)}</div>}
          {section==='activity'&&<div className={panel}><h2 className="text-lg font-semibold">Transactions on this device</h2><p className="my-3 text-sm text-muted-foreground">Confirmed actions for this wallet and series. Your on-chain balances are read independently of this history.</p>{activity.length===0?<p>No confirmed actions recorded on this device.</p>:activity.map(a=><a className="my-3 block break-all text-sm text-brand-text" key={a.hash} href={explorerTx(a.hash)} target="_blank" rel="noreferrer">{a.label} · {new Date(a.time).toLocaleString()} · {a.hash}</a>)}</div>}
          {section==='unsupported'&&<div className={panel}>This feature is unavailable for USTRY. Use the USTRY navigation, or select Blend to use its fixed vault and PT markets.</div>}
          <p className="text-xs text-muted-foreground">{data?`Read ${new Date(data.readAt).toLocaleTimeString()}. `:''}Sandbox NAV relay must remain operational through maturity. No API keys or signing secrets are used by this app.</p>
        </div>
      </main>
    </div>
  </div>;
}
