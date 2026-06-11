import Image from 'next/image';

/**
 * The full Spield wordmark used in the navbar: the brand mark from
 * `public/favicon.png` plus the "Spield" name.
 */
export function SpieldWordmark() {
  return (
    <span className="inline-flex items-center gap-2 font-semibold">
      <Image
        src="/favicon.png"
        alt="Spield"
        width={24}
        height={24}
        className="size-6 rounded"
        priority
      />
      <span className="text-[15px] tracking-tight">Spield</span>
    </span>
  );
}
