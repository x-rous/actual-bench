import { NextResponse } from "next/server";
import { getAppDb } from "@/lib/app-db/connection";
import { AppDbValidationError } from "@/lib/app-db/errors";
import {
  associatePdfDetectionProfile,
  deletePdfDetectionProfile,
  listPdfDetectionProfileCatalog,
  removePdfDetectionAccountAssociation,
  renamePdfDetectionBank,
  renamePdfDetectionProfile,
  savePdfDetectionProfile,
} from "@/lib/app-db/pdfDetectionProfileRepository";
import { appDbErrorResponse, readJsonBody } from "@/lib/app-db/routeResponses";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function GET(request: Request) {
  try {
    const url = new URL(request.url);
    const budgetSyncId = url.searchParams.get("budgetSyncId");
    const accountId = url.searchParams.get("accountId");
    if (!budgetSyncId) {
      throw new AppDbValidationError('Query parameter "budgetSyncId" is required');
    }
    if (!accountId) {
      throw new AppDbValidationError('Query parameter "accountId" is required');
    }
    return NextResponse.json(
      listPdfDetectionProfileCatalog(getAppDb(), budgetSyncId, accountId)
    );
  } catch (error) {
    return appDbErrorResponse(error);
  }
}

export async function POST(request: Request) {
  try {
    const body = await readJsonBody(request);
    if (!isRecord(body)) throw new AppDbValidationError("Request body must be an object");
    const result = savePdfDetectionProfile(getAppDb(), {
      budgetSyncId: String(body.budgetSyncId ?? ""),
      accountId: String(body.accountId ?? ""),
      bankName: String(body.bankName ?? ""),
      profileName: String(body.profileName ?? ""),
      profile: body.profile,
      mode: body.mode === "update" ? "update" : "create",
      assignToAccount: body.assignToAccount === true,
    });
    return NextResponse.json(result, { status: 201 });
  } catch (error) {
    return appDbErrorResponse(error);
  }
}

export async function PATCH(request: Request) {
  try {
    const body = await readJsonBody(request);
    if (!isRecord(body)) throw new AppDbValidationError("Request body must be an object");

    if (body.action === "associate-profile") {
      associatePdfDetectionProfile(getAppDb(), {
        budgetSyncId: String(body.budgetSyncId ?? ""),
        accountId: String(body.accountId ?? ""),
        profileId: String(body.profileId ?? ""),
      });
      return new NextResponse(null, { status: 204 });
    }

    if (body.action === "remove-account-association") {
      removePdfDetectionAccountAssociation(getAppDb(), {
        budgetSyncId: String(body.budgetSyncId ?? ""),
        accountId: String(body.accountId ?? ""),
      });
      return new NextResponse(null, { status: 204 });
    }

    if (body.action === "rename-bank") {
      const bank = renamePdfDetectionBank(getAppDb(), {
        bankId: String(body.bankId ?? ""),
        name: String(body.name ?? ""),
      });
      return NextResponse.json({ bank });
    }

    if (body.action === "rename-profile") {
      const profile = renamePdfDetectionProfile(getAppDb(), {
        profileId: String(body.profileId ?? ""),
        name: String(body.name ?? ""),
      });
      return NextResponse.json({ profile });
    }

    throw new AppDbValidationError("Unknown PDF detection profile action");
  } catch (error) {
    return appDbErrorResponse(error);
  }
}

export async function DELETE(request: Request) {
  try {
    const url = new URL(request.url);
    const profileId = url.searchParams.get("profileId");
    if (!profileId) {
      throw new AppDbValidationError('Query parameter "profileId" is required');
    }
    if (!deletePdfDetectionProfile(getAppDb(), profileId)) {
      return NextResponse.json({ error: "PDF detection profile not found" }, { status: 404 });
    }
    return new NextResponse(null, { status: 204 });
  } catch (error) {
    return appDbErrorResponse(error);
  }
}
