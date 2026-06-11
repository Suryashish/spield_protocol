import type { BaseLayoutProps, LinkItemType } from 'fumadocs-ui/layouts/shared';
import { BookOpen, Code2, Rocket } from 'lucide-react';
import { appUrl } from './shared';
import { SpieldWordmark } from '@/components/logo';

/**
 * Shared layout options (navbar title, links, app CTA) reused by both the docs
 * layout and the home layout.
 */
export function baseOptions(): BaseLayoutProps {
  return {
    nav: {
      title: <SpieldWordmark />,
      transparentMode: 'top',
    },
    links: [
      {
        icon: <BookOpen />,
        text: 'Learn',
        url: '/docs/introduction',
        active: 'nested-url',
      },
      {
        icon: <Rocket />,
        text: 'Get Started',
        url: '/docs/getting-started',
        active: 'nested-url',
      },
      {
        icon: <Code2 />,
        text: 'Developers',
        url: '/docs/developers',
        active: 'nested-url',
      },
      {
        type: 'button',
        text: 'Launch App',
        url: appUrl,
        external: true,
      } satisfies LinkItemType,
    ],
  };
}
