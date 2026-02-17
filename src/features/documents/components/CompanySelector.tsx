import { useMemo, useState } from "react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type { CompanyOption } from "@/features/documents/types";

interface CompanySelectorProps {
  companies: CompanyOption[];
  selectedSymbol: string;
  searchText: string;
  onSearchTextChange: (value: string) => void;
  onSelectSymbol: (symbol: string) => void;
  isLoading: boolean;
  error: string | null;
}

export function CompanySelector({
  companies,
  selectedSymbol,
  searchText,
  onSearchTextChange,
  onSelectSymbol,
  isLoading,
  error,
}: CompanySelectorProps) {
  const [open, setOpen] = useState(false);
  const [highlightedIndex, setHighlightedIndex] = useState(0);

  const selectedCompany = useMemo(
    () => companies.find((company) => company.symbol === selectedSymbol) ?? null,
    [companies, selectedSymbol]
  );

  function handleSelect(company: CompanyOption) {
    onSelectSymbol(company.symbol);
    onSearchTextChange(company.company_name);
    setOpen(false);
  }

  return (
    <div className="space-y-1">
      <Label htmlFor="company-search" className="text-xs text-slate-600">
        Company
      </Label>
      <div className="relative">
        <Input
          id="company-search"
          role="combobox"
          aria-expanded={open}
          aria-controls="company-search-listbox"
          aria-autocomplete="list"
          value={searchText}
          placeholder="Search by name or symbol"
          onFocus={() => {
            setOpen(true);
            if (
              selectedCompany &&
              searchText.trim().toLowerCase() === selectedCompany.company_name.trim().toLowerCase()
            ) {
              onSearchTextChange("");
              setHighlightedIndex(0);
            }
          }}
          onChange={(event) => {
            onSearchTextChange(event.target.value);
            setOpen(true);
            setHighlightedIndex(0);
          }}
          onBlur={() => {
            window.setTimeout(() => setOpen(false), 100);
            if (selectedCompany && searchText.trim().length === 0) {
              onSearchTextChange(selectedCompany.company_name);
            }
          }}
          onKeyDown={(event) => {
            if (!open || companies.length === 0) {
              return;
            }

            if (event.key === "ArrowDown") {
              event.preventDefault();
              setHighlightedIndex((previous) => Math.min(previous + 1, companies.length - 1));
            }

            if (event.key === "ArrowUp") {
              event.preventDefault();
              setHighlightedIndex((previous) => Math.max(previous - 1, 0));
            }

            if (event.key === "Enter") {
              event.preventDefault();
              const company = companies[highlightedIndex];
              if (company) {
                handleSelect(company);
              }
            }
          }}
          className="h-10"
        />

        {open ? (
          <div
            id="company-search-listbox"
            role="listbox"
            className="absolute z-20 mt-1 max-h-[60vh] w-full overflow-y-auto rounded-md border border-slate-200 bg-white shadow-lg"
          >
            {!isLoading && companies.length > 0 ? (
              <p className="border-b border-slate-100 px-3 py-1.5 text-[11px] text-slate-500">
                {companies.length.toLocaleString("en-IN")} companies
              </p>
            ) : null}
            {isLoading ? <p className="px-3 py-2 text-xs text-slate-500">Searching companies...</p> : null}
            {!isLoading && companies.length === 0 ? (
              <p className="px-3 py-2 text-xs text-slate-500">No matching companies found.</p>
            ) : null}
            {!isLoading
              ? companies.map((company, index) => {
                  const isSelected = company.symbol === selectedSymbol;
                  const isHighlighted = index === highlightedIndex;

                  return (
                    <button
                      key={company.symbol}
                      type="button"
                      role="option"
                      aria-selected={isSelected}
                      className={`w-full px-3 py-2 text-left text-sm ${
                        isHighlighted ? "bg-emerald-50" : "bg-white"
                      } ${isSelected ? "text-emerald-700" : "text-slate-700"}`}
                      onMouseDown={(event) => {
                        event.preventDefault();
                        handleSelect(company);
                      }}
                      onMouseEnter={() => setHighlightedIndex(index)}
                    >
                      <p className="font-medium">{company.company_name}</p>
                      <p className="text-xs text-slate-500">{company.symbol}</p>
                    </button>
                  );
                })
              : null}
          </div>
        ) : null}
      </div>
      {selectedCompany ? (
        <p className="text-xs text-slate-500">
          {selectedCompany.symbol}
          {selectedCompany.exchange ? ` • ${selectedCompany.exchange}` : ""}
        </p>
      ) : null}
      {error ? <p className="text-xs text-rose-600">{error}</p> : null}
    </div>
  );
}
