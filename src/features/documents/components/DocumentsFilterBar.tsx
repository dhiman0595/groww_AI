import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type { DocumentTypeFilter, SortOrder } from "@/features/documents/types";

interface DocumentsFilterBarProps {
  docTypeFilter: DocumentTypeFilter;
  onDocTypeFilterChange: (value: DocumentTypeFilter) => void;
  searchText: string;
  onSearchTextChange: (value: string) => void;
  fromDate: string;
  toDate: string;
  onFromDateChange: (value: string) => void;
  onToDateChange: (value: string) => void;
  sortOrder: SortOrder;
  onSortOrderChange: (value: SortOrder) => void;
  onPresetRange: (days: number) => void;
  onClearDateRange: () => void;
}

const FILTER_OPTIONS: Array<{ value: DocumentTypeFilter; label: string }> = [
  { value: "ALL", label: "All" },
  { value: "QUARTERLY_RESULT", label: "Quarterly" },
  { value: "ANNOUNCEMENT", label: "Announcements" },
  { value: "DRHP_RHP", label: "DRHP-RHP" },
  { value: "CONCALL_TRANSCRIPT", label: "Concall" },
];

export function DocumentsFilterBar({
  docTypeFilter,
  onDocTypeFilterChange,
  searchText,
  onSearchTextChange,
  fromDate,
  toDate,
  onFromDateChange,
  onToDateChange,
  sortOrder,
  onSortOrderChange,
  onPresetRange,
  onClearDateRange,
}: DocumentsFilterBarProps) {
  return (
    <div className="space-y-3 border-b border-slate-200 bg-white p-3">
      <div
        className="flex gap-2 overflow-x-auto whitespace-nowrap pb-1"
        role="tablist"
        aria-label="Document type filter"
      >
        {FILTER_OPTIONS.map((option) => (
          <Button
            key={option.value}
            type="button"
            variant={docTypeFilter === option.value ? "default" : "outline"}
            className="h-8 shrink-0 rounded-full px-3 text-xs"
            role="tab"
            aria-selected={docTypeFilter === option.value}
            onClick={() => onDocTypeFilterChange(option.value)}
          >
            {option.label}
          </Button>
        ))}
      </div>

      <div className="grid gap-2">
        <div className="space-y-1">
          <Label htmlFor="docs-search" className="text-xs text-slate-600">
            Search documents
          </Label>
          <Input
            id="docs-search"
            value={searchText}
            onChange={(event) => onSearchTextChange(event.target.value)}
            placeholder="Search title, quarter, tags"
            className="h-9"
          />
        </div>

        <div className="grid grid-cols-1 gap-2">
          <div className="space-y-1">
            <Label htmlFor="from-date" className="text-xs text-slate-600">
              From
            </Label>
            <Input
              id="from-date"
              type="date"
              value={fromDate}
              onChange={(event) => onFromDateChange(event.target.value)}
              className="h-9"
            />
          </div>
          <div className="space-y-1">
            <Label htmlFor="to-date" className="text-xs text-slate-600">
              To
            </Label>
            <Input
              id="to-date"
              type="date"
              value={toDate}
              onChange={(event) => onToDateChange(event.target.value)}
              className="h-9"
            />
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <span className="text-xs text-slate-500">Range:</span>
          <Button type="button" variant="outline" className="h-7 text-xs" onClick={() => onPresetRange(30)}>
            Last 30d
          </Button>
          <Button type="button" variant="outline" className="h-7 text-xs" onClick={() => onPresetRange(90)}>
            Last 90d
          </Button>
          <Button type="button" variant="outline" className="h-7 text-xs" onClick={() => onPresetRange(365)}>
            Last 1Y
          </Button>
          <Button type="button" variant="ghost" className="h-7 text-xs" onClick={onClearDateRange}>
            Clear
          </Button>
        </div>

        <div className="space-y-1">
          <Label htmlFor="sort-order" className="text-xs text-slate-600">
            Sort
          </Label>
          <select
            id="sort-order"
            value={sortOrder}
            onChange={(event) => onSortOrderChange(event.target.value as SortOrder)}
            className="flex h-9 w-full rounded-md border border-slate-200 bg-white px-3 text-sm outline-none focus-visible:ring-2 focus-visible:ring-emerald-300"
          >
            <option value="newest">Newest first</option>
            <option value="oldest">Oldest first</option>
          </select>
        </div>
      </div>
    </div>
  );
}
