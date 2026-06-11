import { Tab, Tabs } from 'fumadocs-ui/components/tabs';

/**
 * The live Spield deployment, per network. Mirrors `frontend/src/lib/config.ts`.
 * Update here when a contract is redeployed.
 */
const DEPLOYMENTS = {
  testnet: {
    label: 'Testnet (live)',
    explorer: 'https://stellar.expert/explorer/testnet',
    rows: [
      ['Wrapper (tokenization engine)', 'CDH7ZGX7QJYIIAUW6Z6LORTLJ7VW7KR4B2INITTSUZL4O22QTMVSYIV4', 'contract'],
      ['Strategy (Blend adapter)', 'CCTSIOSOVXPACHX2E4KXK4QH2CJKVFFWJHBBVLPB6X3XE3EQXKS3KYIT', 'contract'],
      ['Vault (Fixed-Rate Vault)', 'CDEPQKWCBW4Z7XGKPDG2GHNBQ54MOCMCF6PXJFJ5EJM4VJPP6Y4A3ECN', 'contract'],
      ['Market (time-decay AMM)', 'CBY7LGWONKPIRRFSK4BFHK2YLDFPYJ4SLMQJIDVKVXCQZFHYUKJXUFNU', 'contract'],
      ['PT — Principal Token (SAC)', 'CCT4VJ32RBT2Q6UH5UH5QCCCZIRYKXYJX44IDLXUMVFUTLZDXBPBJLUW', 'contract'],
      ['YT — Yield Token (SAC)', 'CA2QLQDSJUR6H5QNZSYURGGMZPGJI7D4WEYPXBSXWDLX7FCFZF7FD2OU', 'contract'],
      ['USDC (SAC)', 'CAQCFVLOBK5GIULPNZRGATJJMIZL5BSP7X5YJVMGCPTUEPFM4AVSRCJU', 'contract'],
    ],
  },
  mainnet: {
    label: 'Mainnet (coming soon)',
    explorer: 'https://stellar.expert/explorer/public',
    rows: [
      ['Wrapper (tokenization engine)', 'CDLQY72EFRTNGNXT4PSINHGA4ET5CW3I6FHUSYUOL2HIWV6I55WW46WW', 'contract'],
      ['Strategy (Blend adapter)', 'CCTRXF5U2P2IMANRH5B54UJGV53APU4IID2QTINFQBZZWOPB765QZVW4', 'contract'],
      ['Vault (Fixed-Rate Vault)', 'CDWNGJDYZ7VUYRG73WOU6PR6HCYPHO77UICJO642OWSP7LQGRRYPFLX6', 'contract'],
      ['Market (time-decay AMM)', 'CBTO72XLCM2HV2MW64GMGWQB57NQFDXO3BZJTW3Y5ENTXBAJQ7Z7G5FV', 'contract'],
      ['PT — Principal Token (SAC)', 'CDDYIUGAZBSJNYAR2WYPRNHEGOFS25GPY22W7SHHQHIMTMKX5WQ25IXD', 'contract'],
      ['YT — Yield Token (SAC)', 'CDGQLIJVMKRFTYUXOMQAG4YFUN22OKXMOT2K4JA33KDM6P2FCBZTV6CU', 'contract'],
      ['USDC — Circle (SAC)', 'CCW67TSZV3SSS2HXMBQ5JFGCKJNXKZM7UQUWUZPUTHXSTZLEO7SJMI75', 'contract'],
    ],
  },
} as const;

function AddressTable({ network }: { network: keyof typeof DEPLOYMENTS }) {
  const { explorer, rows } = DEPLOYMENTS[network];
  return (
    <div className="overflow-x-auto">
      <table className="my-0 w-full text-sm">
        <thead>
          <tr>
            <th className="text-left">Contract</th>
            <th className="text-left">Address</th>
          </tr>
        </thead>
        <tbody>
          {rows.map(([name, id, kind]) => (
            <tr key={id}>
              <td className="whitespace-nowrap">{name}</td>
              <td>
                <a
                  href={`${explorer}/${kind}/${id}`}
                  target="_blank"
                  rel="noreferrer"
                  className="font-mono text-[12px] break-all"
                  title="View on Stellar Expert"
                >
                  {id}
                </a>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/**
 * The live Spield contract addresses, tabbed by network, with explorer links.
 * Used on the Developers → Contract addresses page.
 */
export function ContractTables() {
  return (
    <Tabs items={['Testnet (live)', 'Mainnet (coming soon)']}>
      <Tab value="Testnet (live)">
        <AddressTable network="testnet" />
      </Tab>
      <Tab value="Mainnet (coming soon)">
        <AddressTable network="mainnet" />
      </Tab>
    </Tabs>
  );
}
