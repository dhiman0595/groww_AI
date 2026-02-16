import { useEffect, useState } from "react";
import { fetchCompanies } from "@/features/documents/api/documentsClient";
import type { CompanyOption } from "@/features/documents/types";

export function useCompaniesQuery(query: string) {
  const [data, setData] = useState<CompanyOption[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;

    async function run() {
      setIsLoading(true);
      setError(null);

      try {
        const companies = await fetchCompanies(query);

        if (!active) {
          return;
        }

        setData(companies);
      } catch (err) {
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
    };
  }, [query]);

  return {
    data,
    isLoading,
    error,
  };
}
