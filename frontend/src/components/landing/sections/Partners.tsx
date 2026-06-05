const partners = [
  { name: 'Stellar', icon: '✦' },
  { name: 'Soroban', icon: '◈' },
  { name: 'Blend', icon: '⬢' },
  { name: 'USDC', icon: '◉' },
];

const Item = ({ name, icon }: { name: string; icon: string }) => (
  <div className="flex shrink-0 items-center gap-2.5 px-6 opacity-30 hover:opacity-70 transition-opacity duration-500">
    <span className="text-lg text-brand-primary/80">{icon}</span>
    <span className="text-[11px] font-bold tracking-[0.22em] text-white whitespace-nowrap">
      {name.toUpperCase()}
    </span>
  </div>
);

const Partners = () => {
  // One "group" repeats the short partner list enough times to exceed any normal
  // viewport width. We render that group TWICE and translate the track by exactly
  // -50% (one full group), so the second group seamlessly takes over with no gap.
  const group = Array.from({ length: 4 }, () => partners).flat();

  return (
    <div className="w-full">
      <p className="text-center text-[10px] uppercase tracking-[0.3em] text-white/30 mb-8">
        Built on the Stellar ecosystem
      </p>
      <div className="relative overflow-hidden [mask-image:linear-gradient(90deg,transparent,#000_12%,#000_88%,transparent)]">
        <div className="flex w-max animate-marquee">
          {/* group 1 */}
          <div className="flex shrink-0">
            {group.map((p, i) => (
              <Item key={`a-${p.name}-${i}`} name={p.name} icon={p.icon} />
            ))}
          </div>
          {/* group 2 — identical, makes the -50% loop seamless */}
          <div className="flex shrink-0" aria-hidden="true">
            {group.map((p, i) => (
              <Item key={`b-${p.name}-${i}`} name={p.name} icon={p.icon} />
            ))}
          </div>
        </div>
      </div>
    </div>
  );
};

export default Partners;
