import { useEffect, useState } from "react";
import { fetchCompanies } from "@/features/documents/api/documentsClient";
import type { CompanyOption } from "@/features/documents/types";

interface UseCompaniesQueryOptions {
  limit?: number;
}

export function useCompaniesQuery(query: string, options: UseCompaniesQueryOptions = {}) {
  const [data, setData] = useState<CompanyOption[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [debouncedQuery, setDebouncedQuery] = useState(query);
  const limit = Number.isFinite(options.limit) ? Number(options.limit) : undefined;

  useEffect(() => {
    const timeout = window.setTimeout(() => {
      setDebouncedQuery(query);
    }, 220);

    return () => window.clearTimeout(timeout);
  }, [query]);

  useEffect(() => {
    let active = true;
    const controller = new AbortController();

    async function run() {
      setIsLoading(true);
      setError(null);

      try {
        const companies = await fetchCompanies(debouncedQuery, controller.signal, limit);

        if (!active) {
          return;
        }

        setData(companies);
      } catch (err) {
        if (controller.signal.aborted) {
          return;
        }

        if (!active) {
          return;
        }

        setError(err instanceof Error ? err.message : "Failed to fetch companies.");
      } finally {
        if (active) {
          setIsLoading(false);
        }
      }
    }

    void run();

    return () => {
      active = false;
      controller.abort();
    };
  }, [debouncedQuery, limit]);

  return {
    data,
    isLoading,
    error,
  };
}
