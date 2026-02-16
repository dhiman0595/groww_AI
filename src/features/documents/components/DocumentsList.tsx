import { useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import type { CompanyDocument } from "@/features/documents/types";

interface DocumentsListProps {
  items: CompanyDocument[];
  isLoading: boolean;
  error: string | null;
  page: number;
  pageSize: number;
  total: number;
  onPageChange: (page: number) => void;
}

function formatDocumentType(type: CompanyDocument["doc_type"]): string {
  switch (type) {
    case "QUARTERLY_RESULT":
      return "Quarterly";
    case "ANNOUNCEMENT":
      return "Announcement";
    case "DRHP":
      return "DRHP";
    case "RHP":
      return "RHP";
    case "OFFER_DOCUMENT":
      return "Offer Document";
    case "CONCALL_TRANSCRIPT":
      return "Concall";
    case "INVESTOR_PRESENTATION":
      return "Presentation";
    default:
      return "Other";
  }
}

function formatDate(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return "Unknown";
  }

  return date.toLocaleString("en-IN", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
}

export function DocumentsList({
  items,
  isLoading,
  error,
  page,
  pageSize,
  total,
  onPageChange,
}: DocumentsListProps) {
  const [copiedDocId, setCopiedDocId] = useState<string | null>(null);

  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const hasPrevious = page > 1;
  const hasNext = page < totalPages;

  async function handleCopyLink(document: CompanyDocument) {
    const link = document.file_url ?? document.source_url;
    if (!link) {
      return;
    }

    try {
      await navigator.clipboard.writeText(link);
      setCopiedDocId(document.id);
      window.setTimeout(() => setCopiedDocId(null), 1000);
    } catch {
      setCopiedDocId(null);
    }
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="min-h-0 flex-1 space-y-3 overflow-y-auto p-3">
        {isLoading ? <p className="text-sm text-slate-500">Loading documents...</p> : null}
        {error ? <p className="text-sm text-rose-600">{error}</p> : null}

        {!isLoading && !error && items.length === 0 ? (
          <div className="rounded-lg border border-dashed border-slate-300 bg-slate-50 p-4 text-sm text-slate-500">
            No documents found for current filters. Try broadening date range or search.
          </div>
        ) : null}

        {items.map((document) => {
          const openUrl = document.source_url || document.file_url;
          const downloadUrl = document.file_url;
          const canOpen = Boolean(openUrl);
          const canDownload = Boolean(downloadUrl);

          return (
            <article key={document.id} className="rounded-xl border border-slate-200 bg-white p-3 shadow-sm">
              <div className="flex flex-wrap items-center gap-2">
                <Badge variant="secondary">{formatDocumentType(document.doc_type)}</Badge>
                <Badge variant="outline">{document.exchange ?? "OTHER"}</Badge>
                <Badge variant="outline">{document.source_name}</Badge>
              </div>

              <h3 className="mt-2 text-sm font-semibold text-slate-900">{document.title}</h3>
              <p className="mt-1 text-xs text-slate-500">
                {document.company_name} ({document.symbol})
              </p>

              <div className="mt-2 grid grid-cols-1 gap-1 text-xs text-slate-600">
                <p>Published: {formatDate(document.published_at)}</p>
                <p>Quarter: {document.quarter ?? "-"}</p>
                <p>FY: {document.fiscal_year ?? "-"}</p>
                <p>Language: {document.language ?? "en"}</p>
              </div>

              {document.description ? (
                <p className="mt-2 text-xs leading-relaxed text-slate-600">{document.description}</p>
              ) : null}

              <div className="mt-3 flex flex-wrap gap-1.5">
                <Button
                  type="button"
                  variant="outline"
                  className="h-7 px-2.5 text-[11px]"
                  disabled={!canOpen}
                  onClick={() => {
                    if (!openUrl) {
                      return;
                    }
                    window.open(openUrl, "_blank", "noopener,noreferrer");
                  }}
                >
                  Open
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  className="h-7 px-2.5 text-[11px]"
                  disabled={!canDownload}
                  onClick={() => {
                    if (!downloadUrl) {
                      return;
                    }
                    const anchor = window.document.createElement("a");
                    anchor.href = downloadUrl;
                    anchor.target = "_blank";
                    anchor.rel = "noopener noreferrer";
                    anchor.download = "";
                    anchor.click();
                  }}
                >
                  Download
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  className="h-7 px-2.5 text-[11px]"
                  disabled={!canOpen}
                  onClick={() => {
                    void handleCopyLink(document);
                  }}
                >
                  {copiedDocId === document.id ? "Copied" : "Copy Link"}
                </Button>
                {!canOpen ? <span className="text-[11px] text-slate-400">Link unavailable</span> : null}
              </div>
            </article>
          );
        })}
      </div>

      <div className="flex flex-col gap-2 border-t border-slate-200 px-3 py-2 sm:flex-row sm:items-center sm:justify-between">
        <p className="text-xs text-slate-500">
          {total} documents • Page {page} of {totalPages}
        </p>
        <div className="flex gap-2">
          <Button type="button" size="sm" variant="outline" disabled={!hasPrevious} onClick={() => onPageChange(page - 1)}>
            Previous
          </Button>
          <Button type="button" size="sm" variant="outline" disabled={!hasNext} onClick={() => onPageChange(page + 1)}>
            Next
          </Button>
        </div>
      </div>
    </div>
  );
}
