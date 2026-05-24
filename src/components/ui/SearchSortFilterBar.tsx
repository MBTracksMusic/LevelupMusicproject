import { Search, SlidersHorizontal, X } from 'lucide-react';
import { Button } from './Button';
import { Input } from './Input';
import { Select } from './Select';
import { useTranslation } from '../../lib/i18n';

interface SortOption {
  value: string;
  label: string;
}

interface SearchSortFilterBarProps {
  searchValue: string;
  searchPlaceholder: string;
  onSearchChange: (value: string) => void;
  sortValue: string;
  sortOptions: SortOption[];
  onSortChange: (value: string) => void;
  showFilters?: boolean;
  onToggleFilters?: () => void;
  hasActiveFilters?: boolean;
  onClearFilters?: () => void;
  filterLabel?: string;
  clearLabel?: string;
}

export function SearchSortFilterBar({
  searchValue,
  searchPlaceholder,
  onSearchChange,
  sortValue,
  sortOptions,
  onSortChange,
  showFilters,
  onToggleFilters,
  hasActiveFilters,
  onClearFilters,
  filterLabel,
  clearLabel,
}: SearchSortFilterBarProps) {
  const { t } = useTranslation();
  const filterText = filterLabel ?? t('common.filter');
  const clearText = clearLabel ?? t('products.clearFilters');

  return (
    <div className="flex flex-col lg:flex-row gap-4 mb-8">
      <div className="flex-1">
        <Input
          type="text"
          placeholder={searchPlaceholder}
          value={searchValue}
          onChange={(e) => onSearchChange(e.target.value)}
          leftIcon={<Search className="w-5 h-5" />}
        />
      </div>

      <div className="flex gap-3">
        <Select
          value={sortValue}
          onChange={(e) => onSortChange(e.target.value)}
          options={sortOptions}
        />

        {onToggleFilters && (
          <Button
            variant={showFilters ? 'primary' : 'outline'}
            onClick={onToggleFilters}
            leftIcon={<SlidersHorizontal className="w-4 h-4" />}
          >
            {filterText}
          </Button>
        )}

        {hasActiveFilters && onClearFilters && (
          <Button variant="ghost" onClick={onClearFilters} leftIcon={<X className="w-4 h-4" />}>
            {clearText}
          </Button>
        )}
      </div>
    </div>
  );
}
