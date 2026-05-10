export type ExternalProviderId = "desjardins_erc_reer_collectif" | "other";

export type ExternalProviderPreset = {
  id: ExternalProviderId;
  label: string;
  defaultPortalUrl: string | null;
  defaultAccountTypeLabel: string;
};

export const EXTERNAL_ACCOUNT_PROVIDERS: ExternalProviderPreset[] = [
  {
    id: "desjardins_erc_reer_collectif",
    label: "Desjardins — REER collectif (portail ERC / assureur)",
    defaultPortalUrl: "https://www.erc-grs.dsf-dfs.com/",
    defaultAccountTypeLabel: "REER collectif (externe)",
  },
  {
    id: "other",
    label: "Autre institution",
    defaultPortalUrl: null,
    defaultAccountTypeLabel: "Compte externe",
  },
];

export function externalProviderPreset(
  provider: string,
): ExternalProviderPreset | undefined {
  return EXTERNAL_ACCOUNT_PROVIDERS.find((p) => p.id === provider);
}
