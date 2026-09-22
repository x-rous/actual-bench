import { NextResponse } from "next/server";
import { getAppDb } from "@/lib/app-db/connection";
import { AppDbValidationError } from "@/lib/app-db/errors";
import {
  assignPdfStatementLayout,
  deletePdfStatementLayout,
  listPdfStatementLayouts,
  removePdfStatementLayoutAssignment,
  renamePdfStatementLayout,
  renamePdfStatementLayoutBank,
  savePdfStatementLayout,
} from "@/lib/app-db/pdfStatementLayoutRepository";
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
    if (!budgetSyncId) throw new AppDbValidationError('Query parameter "budgetSyncId" is required');
    if (!accountId) throw new AppDbValidationError('Query parameter "accountId" is required');
    return NextResponse.json(listPdfStatementLayouts(getAppDb(), budgetSyncId, accountId));
  } catch (error) {
    return appDbErrorResponse(error);
  }
}

export async function POST(request: Request) {
  try {
    const body = await readJsonBody(request);
    if (!isRecord(body)) throw new AppDbValidationError("Request body must be an object");
    const layout = savePdfStatementLayout(getAppDb(), {
      budgetSyncId: String(body.budgetSyncId ?? ""),
      accountId: String(body.accountId ?? ""),
      bankName: String(body.bankName ?? ""),
      layoutName: String(body.layoutName ?? ""),
      layout: body.layout,
      mode: body.mode === "update" ? "update" : "create",
      assignToAccount: body.assignToAccount === true,
    });
    return NextResponse.json({ layout }, { status: 201 });
  } catch (error) {
    return appDbErrorResponse(error);
  }
}

export async function PATCH(request: Request) {
  try {
    const body = await readJsonBody(request);
    if (!isRecord(body)) throw new AppDbValidationError("Request body must be an object");

    if (body.action === "assign-layout") {
      assignPdfStatementLayout(getAppDb(), {
        budgetSyncId: String(body.budgetSyncId ?? ""),
        accountId: String(body.accountId ?? ""),
        layoutId: String(body.layoutId ?? ""),
      });
      return new NextResponse(null, { status: 204 });
    }

    if (body.action === "remove-assignment") {
      removePdfStatementLayoutAssignment(getAppDb(), {
        budgetSyncId: String(body.budgetSyncId ?? ""),
        accountId: String(body.accountId ?? ""),
      });
      return new NextResponse(null, { status: 204 });
    }

    if (body.action === "rename-bank") {
      const renamed = renamePdfStatementLayoutBank(getAppDb(), {
        from: String(body.from ?? ""),
        to: String(body.to ?? ""),
      });
      return NextResponse.json({ renamed });
    }

    if (body.action === "rename-layout") {
      const layout = renamePdfStatementLayout(getAppDb(), {
        layoutId: String(body.layoutId ?? ""),
        name: String(body.name ?? ""),
      });
      return NextResponse.json({ layout });
    }

    throw new AppDbValidationError("Unknown statement layout action");
  } catch (error) {
    return appDbErrorResponse(error);
  }
}

export async function DELETE(request: Request) {
  try {
    const url = new URL(request.url);
    const layoutId = url.searchParams.get("layoutId");
    if (!layoutId) throw new AppDbValidationError('Query parameter "layoutId" is required');
    if (!deletePdfStatementLayout(getAppDb(), layoutId)) {
      return NextResponse.json({ error: "Statement layout not found" }, { status: 404 });
    }
    return new NextResponse(null, { status: 204 });
  } catch (error) {
    return appDbErrorResponse(error);
  }
}
