import type { Metadata } from "next";
import { AssetWorkspace } from "@/features/asset-registry/AssetWorkspace";
export const metadata: Metadata = { title: "Assets - Actual Bench" };
export default function AssetsPage() { return <AssetWorkspace />; }
