import {useEffect,useRef,useState} from 'react';
import {useSeries} from '@/context/SeriesContext';
import {useWallet} from '@/context/WalletContext';
import {useToast} from '@/context/ToastContext';
import {addConversionTrustlines,CIRCLE_ISSUER,conversionQuote,executeConversion,GATAL_ISSUER,swapAsset,USTRY_ISSUER,type ConversionQuote} from '@/lib/ustry-conversion';
import {quantity,units} from '@/lib/ustry';
export default function UstryConversion({busyParent,onConfirmed}:{busyParent:boolean;onConfirmed:(hash:string)=>Promise<void>}){
  const {activeSeries}=useSeries();const {address,onCorrectNetwork}=useWallet();const {push,update}=useToast();
  const [issuer,setIssuer]=useState(GATAL_ISSUER);const [reverse,setReverse]=useState(false);const [amount,setAmount]=useState('');
  const [quote,setQuote]=useState<ConversionQuote|null>(null);const [error,setError]=useState('');const [busy,setBusy]=useState(false);const [now,setNow]=useState(Date.now());
  const generation=useRef(0);const mounted=useRef(true);
  useEffect(()=>{mounted.current=true;return()=>{mounted.current=false;generation.current++;};},[]);
  useEffect(()=>{generation.current++;setQuote(null);setError('');},[issuer,reverse,amount,address,activeSeries.id]);
  useEffect(()=>{const timer=setInterval(()=>setNow(Date.now()),1000);return()=>clearInterval(timer);},[]);
  const usdc=swapAsset('USDC',issuer);const ustry=swapAsset('USTRY',USTRY_ISSUER);
  const source=reverse?ustry:usdc;const destination=reverse?usdc:ustry;
  async function getQuote(){if(!address)return;const id=++generation.current;setBusy(true);setQuote(null);setError('');try{const q=await conversionQuote(address,activeSeries.id,source,destination,quantity(amount));if(mounted.current&&id===generation.current)setQuote(q);}catch(e){if(mounted.current&&id===generation.current)setError(e instanceof Error?e.message:'Quote failed.');}finally{if(mounted.current)setBusy(false);}}
  async function run(label:string,fn:()=>Promise<{hash:string}>){setBusy(true);setError('');const id=push({kind:'pending',title:label,message:'Confirm in your wallet…'});try{const result=await fn();update(id,{kind:'success',title:label+' confirmed',hash:result.hash});if(mounted.current){setQuote(null);await onConfirmed(result.hash);}}catch(e){update(id,{kind:'error',title:label+' failed',message:e instanceof Error?e.message:'Transaction failed.'});}finally{if(mounted.current)setBusy(false);}}
  const disabled=busy||busyParent||!address||!onCorrectNetwork;
  return <div className="rounded-2xl border border-border bg-card p-5"><h2 className="text-lg font-semibold">USDC ↔ USTRY</h2><p className="my-3 text-sm text-muted-foreground">One Stellar exchange transaction returns the output to your own wallet. This is a liquidity quote, not a fiat redemption or a guaranteed NAV conversion. The two test USDC issuers can trade at different prices.</p><div className="grid max-w-xl gap-3">
    <label>USDC asset<select aria-label="Conversion USDC issuer" className="w-full rounded-xl border border-border bg-canvas p-2" value={issuer} disabled={busy} onChange={e=>setIssuer(e.target.value)}><option value={GATAL_ISSUER}>GATAL test USDC · existing Blend asset</option><option value={CIRCLE_ISSUER}>GBBD test USDC · Circle-listed testnet asset</option></select></label>
    <p className="break-all text-xs text-muted-foreground">USDC issuer: {issuer}<br/>USTRY issuer: {USTRY_ISSUER}</p>
    <label>Direction<select aria-label="Conversion direction" className="w-full rounded-xl border border-border bg-canvas p-2" value={reverse?'sell':'buy'} disabled={busy} onChange={e=>setReverse(e.target.value==='sell')}><option value="buy">USDC → USTRY</option><option value="sell">USTRY → USDC</option></select></label>
    <label>Spend amount · {source.code}<input aria-label="Conversion amount" className="w-full rounded-xl border border-border bg-canvas p-2" inputMode="decimal" value={amount} disabled={busy} onChange={e=>setAmount(e.target.value)}/></label>
    <button className="rounded-full border border-border px-4 py-2 disabled:opacity-40" disabled={disabled} onClick={()=>address&&void run('Add asset trustlines',()=>addConversionTrustlines(address,activeSeries.id,[usdc,ustry]))}>Add required trustlines</button>
    <button className="rounded-full border border-border px-4 py-2 disabled:opacity-40" disabled={disabled||!amount} onClick={()=>void getQuote()}>Get quote</button>
    {error&&<p role="alert" className="text-danger-text">{error}</p>}
    {quote&&<div className="space-y-3 rounded-xl border border-border p-3"><p>Estimated output: {units(quote.output)} {quote.destination.code}</p><p>Minimum received: {units(quote.minimum)} {quote.destination.code} (1% slippage limit).</p><p className="text-xs">Route: {quote.source.code} → {quote.path.map(a=>`${a.code} (${a.issuer?.slice(0,4)}…) → `)}{quote.destination.code}. {now>=quote.expires?'Quote expired; get a new quote.':`Expires in ${Math.ceil((quote.expires-now)/1000)}s.`}</p><button className="rounded-full border border-border bg-brand px-4 py-2 disabled:opacity-40" disabled={disabled||now>=quote.expires} onClick={()=>address&&void run('Convert '+quote.source.code,()=>executeConversion(address,quote))}>Review conversion in wallet</button></div>}
  </div></div>;
}
