import { AssetWorkspace } from "@/features/asset-registry/AssetWorkspace";
export default async function AssetPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <AssetWorkspace assetId={id} />;
}
