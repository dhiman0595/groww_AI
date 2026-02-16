import { useEffect, useState } from "react";
import { fetchDocuments } from "@/features/documents/api/documentsClient";
import type { DocumentsQueryParams, DocumentsResponse } from "@/features/documents/types";

const EMPTY_RESPONSE: DocumentsResponse = {
  items: [],
  total: 0,
  page: 1,
  page_size: 10,
};

export function useDocumentsQuery(params: DocumentsQueryParams) {
  const { symbol, doc_type, q, from, to, sort, page, page_size } = params;
  const [data, setData] = useState<DocumentsResponse>(EMPTY_RESPONSE);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!symbol) {
      setData(EMPTY_RESPONSE);
      return;
    }

    let active = true;

    async function run() {
      setIsLoading(true);
      setError(null);

      try {
        const result = await fetchDocuments({
          symbol,
          doc_type,
          q,
          from,
          to,
          sort,
          page,
          page_size,
        });

        if (!active) {
          return;
        }

        setData(result);
      } catch (err) {
        if (!active) {
          return;
        }

        setError(err instanceof Error ? err.message : "Failed to fetch documents.");
      } finally {
        if (active) {
          setIsLoading(false);
        }
      }
    }

    void run();

    return () => {
      active = false;
    };
  }, [symbol, doc_type, q, from, to, sort, page, page_size]);

  return {
    data,
    isLoading,
    error,
  };
}
