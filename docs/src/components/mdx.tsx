import defaultMdxComponents from 'fumadocs-ui/mdx';
import type { MDXComponents } from 'mdx/types';
import { Mermaid } from '@/components/mermaid';
import { Callout } from 'fumadocs-ui/components/callout';
import { Card, Cards } from 'fumadocs-ui/components/card';
import { Tab, Tabs } from 'fumadocs-ui/components/tabs';
import { Step, Steps } from 'fumadocs-ui/components/steps';
import { Accordion, Accordions } from 'fumadocs-ui/components/accordion';
import { TypeTable } from 'fumadocs-ui/components/type-table';
import { DevPhaseNote } from '@/components/network-status';
import { ContractTables } from '@/components/contract-tables';

export function getMDXComponents(components?: MDXComponents): MDXComponents {
  return {
    ...defaultMdxComponents,
    // Components made available to every MDX page without an import.
    Callout,
    Card,
    Cards,
    Tab,
    Tabs,
    Step,
    Steps,
    Accordion,
    Accordions,
    TypeTable,
    // `Mermaid` is referenced by the `remarkMdxMermaid` plugin (source.config.ts),
    // which rewrites ```mermaid fenced blocks into <Mermaid chart="…" /> at build
    // time so diagrams render visually instead of as raw code.
    Mermaid,
    DevPhaseNote,
    ContractTables,
    ...components,
  };
}

export const useMDXComponents = getMDXComponents;

declare global {
  type MDXProvidedComponents = ReturnType<typeof getMDXComponents>;
}
