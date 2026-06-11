import { redirect } from 'next/navigation';

/**
 * The docs site has no separate marketing landing page — the main Spield app
 * already serves that. The root path redirects straight into the documentation.
 */
export default function HomePage() {
  redirect('/docs/introduction');
}
