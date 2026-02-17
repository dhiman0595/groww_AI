import { useEffect, useMemo, useRef, useState } from "react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type { CompanyOption } from "@/features/documents/types";

interface CompanySelectorProps {
  companies: CompanyOption[];
  selectedSymbol: string;
  selectedCompanyName?: string;
  searchText: string;
  minSearchChars?: number;
  onSearchTextChange: (value: string) => void;
  onSelectSymbol: (symbol: string) => void;
  isLoading: boolean;
  error: string | null;
}

export function CompanySelector({
  companies,
  selectedSymbol,
  selectedCompanyName,
  searchText,
  minSearchChars = 2,
  onSearchTextChange,
  onSelectSymbol,
  isLoading,
  error,
}: CompanySelectorProps) {
  const OPTION_HEIGHT = 56;
  const VIRTUAL_OVERSCAN = 6;
  const [open, setOpen] = useState(false);
  const [highlightedIndex, setHighlightedIndex] = useState(0);
  const [scrollTop, setScrollTop] = useState(0);
  const [viewportHeight, setViewportHeight] = useState(0);
  const listViewportRef = useRef<HTMLDivElement | null>(null);

  const selectedCompany = useMemo(
    () => companies.find((company) => company.symbol === selectedSymbol) ?? null,
    [companies, selectedSymbol]
  );
  const selectedLabel = selectedCompany?.company_name || `${selectedCompanyName || ""}`.trim();
  const normalizedSearchText = searchText.trim();
  const requiresMoreInput = normalizedSearchText.length < minSearchChars;
  const shouldVirtualize = open && !isLoading && companies.length > 80;

  useEffect(() => {
    if (!open || !listViewportRef.current) {
      return;
    }

    const viewport = listViewportRef.current;
    const updateHeight = () => setViewportHeight(viewport.clientHeight);
    updateHeight();
    window.addEventListener("resize", updateHeight);
    return () => {
      window.removeEventListener("resize", updateHeight);
    };
  }, [open]);

  useEffect(() => {
    if (!open || !listViewportRef.current || companies.length === 0) {
      return;
    }

    const viewport = listViewportRef.current;
    const currentTop = viewport.scrollTop;
    const viewportBottom = currentTop + viewport.clientHeight;
    const optionTop = highlightedIndex * OPTION_HEIGHT;
    const optionBottom = optionTop + OPTION_HEIGHT;

    if (optionTop < currentTop) {
      viewport.scrollTop = optionTop;
      return;
    }

    if (optionBottom > viewportBottom) {
      viewport.scrollTop = Math.max(0, optionBottom - viewport.clientHeight);
    }
  }, [companies.length, highlightedIndex, open]);

  const virtualizationState = useMemo(() => {
    if (!shouldVirtualize) {
      return {
        startIndex: 0,
        endIndex: companies.length,
        totalHeight: companies.length * OPTION_HEIGHT,
      };
    }

    const viewHeight = viewportHeight > 0 ? viewportHeight : 320;
    const visibleRows = Math.ceil(viewHeight / OPTION_HEIGHT) + VIRTUAL_OVERSCAN * 2;
    const maxStart = Math.max(0, companies.length - visibleRows);
    const startIndex = Math.min(maxStart, Math.max(0, Math.floor(scrollTop / OPTION_HEIGHT) - VIRTUAL_OVERSCAN));
    const endIndex = Math.min(companies.length, startIndex + visibleRows);

    return {
      startIndex,
      endIndex,
      totalHeight: companies.length * OPTION_HEIGHT,
    };
  }, [companies.length, scrollTop, shouldVirtualize, viewportHeight]);

  const renderedCompanies = useMemo(() => {
    if (!shouldVirtualize) {
      return companies.map((company, index) => ({ company, index }));
    }

    return companies
      .slice(virtualizationState.startIndex, virtualizationState.endIndex)
      .map((company, offset) => ({
        company,
        index: virtualizationState.startIndex + offset,
      }));
  }, [companies, shouldVirtualize, virtualizationState.endIndex, virtualizationState.startIndex]);

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
              selectedLabel &&
              searchText.trim().toLowerCase() === selectedLabel.toLowerCase()
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
            if (selectedLabel && searchText.trim().length === 0) {
              onSearchTextChange(selectedLabel);
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
            className="absolute z-20 mt-1 w-full rounded-md border border-slate-200 bg-white shadow-lg"
          >
            {!isLoading && companies.length > 0 ? (
              <p className="border-b border-slate-100 px-3 py-1.5 text-[11px] text-slate-500">
                {companies.length.toLocaleString("en-IN")} companies
              </p>
            ) : null}
            {isLoading ? <p className="px-3 py-2 text-xs text-slate-500">Searching companies...</p> : null}
            {!isLoading && requiresMoreInput ? (
              <p className="px-3 py-2 text-xs text-slate-500">
                Type at least {minSearchChars} characters to search.
              </p>
            ) : null}
            {!isLoading && !requiresMoreInput && companies.length === 0 ? (
              <p className="px-3 py-2 text-xs text-slate-500">No matching companies found.</p>
            ) : null}
            {!isLoading && !requiresMoreInput && companies.length > 0 ? (
              <div
                ref={listViewportRef}
                className="max-h-[60vh] overflow-y-auto"
                onScroll={(event) => {
                  setScrollTop(event.currentTarget.scrollTop);
                }}
              >
                {shouldVirtualize ? (
                  <div className="relative" style={{ height: virtualizationState.totalHeight }}>
                    {renderedCompanies.map(({ company, index }) => {
                      const isSelected = company.symbol === selectedSymbol;
                      const isHighlighted = index === highlightedIndex;

                      return (
                        <button
                          key={company.symbol}
                          type="button"
                          role="option"
                          aria-selected={isSelected}
                          className={`absolute left-0 right-0 h-14 px-3 py-2 text-left text-sm ${
                            isHighlighted ? "bg-emerald-50" : "bg-white"
                          } ${isSelected ? "text-emerald-700" : "text-slate-700"}`}
                          style={{ top: index * OPTION_HEIGHT }}
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
                    })}
                  </div>
                ) : (
                  renderedCompanies.map(({ company, index }) => {
                    const isSelected = company.symbol === selectedSymbol;
                    const isHighlighted = index === highlightedIndex;

                    return (
                      <button
                        key={company.symbol}
                        type="button"
                        role="option"
                        aria-selected={isSelected}
                        className={`w-full h-14 px-3 py-2 text-left text-sm ${
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
                )}
              </div>
            ) : null}
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
