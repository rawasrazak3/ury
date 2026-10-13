import { useCallback, useEffect, useMemo, useState } from 'react';
import { call, formatCurrency } from '@ury/core';
import { StatCard, DataTable, type DataTableColumn } from '@ury/ui';
import { Ban, IndianRupee, Package, TrendingUp } from 'lucide-react';
import { startOfDay, subDays, endOfDay } from 'date-fns';
import { useBranchContext } from '../../context/BranchContext';
import { DateRangeFilter, type DateRangeValue } from '../../components/reports/DateRangeFilter';
import { SearchableSelect } from '../../components/common/SearchableSelect';
import { toApiDate } from '../../lib/reportDate';
import { NoSales } from './PeakHourSales';
import { MEAL_SLOT_KEYS, MEAL_SLOT_STYLE, type MealSlotDef, type MealSlotKey } from '../../lib/mealSlots';

type SortMode = 'fast' | 'sales' | 'slow';

interface MovementRow extends Record<MealSlotKey, number> {
  rank: number;
  item_code: string;
  item_name: string;
  course: string | null;
  qty: number;
  amount: number;
  bills: number;
  pct_qty: number;
  avg_qty_per_day: number;
  last_sold: string | null;
}

interface ItemMovementData {
  slot_defs: MealSlotDef[];
  summary: {
    items_sold: number;
    items_not_sold: number;
    total_qty: number;
    total_amount: number;
    top_item: string | null;
    top_item_qty: number;
  };
  rows: MovementRow[];
}

const SORT_OPTIONS: Array<{ value: SortMode; label: string }> = [
  { value: 'fast', label: 'Fast moving (qty)' },
  { value: 'sales', label: 'Top sales (₹)' },
  { value: 'slow', label: 'Slow moving' },
];

const formatQty = (qty: number) => (Number.isInteger(qty) ? String(qty) : qty.toFixed(2));

export function ItemMovement() {
  const { activeBranchId } = useBranchContext();
  const [range, setRange] = useState<DateRangeValue>(() => ({
    from: startOfDay(subDays(new Date(), 29)),
    to: endOfDay(new Date()),
  }));
  const [slot, setSlot] = useState<MealSlotKey | ''>('');
  const [sort, setSort] = useState<SortMode>('fast');
  const [search, setSearch] = useState('');
  const [data, setData] = useState<ItemMovementData | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchData = useCallback(async () => {
    setIsLoading(true);
    try {
      setError(null);
      const branch = activeBranchId === 'all' ? undefined : activeBranchId;
      const res = await call<{ message: ItemMovementData }>('ury.ury.report_api.peak_hours.get_item_movement', {
        branch,
        start_date: toApiDate(range.from),
        end_date: toApiDate(range.to),
        slot: slot || undefined,
        sort,
      });
      setData(res.message ?? (res as unknown as ItemMovementData));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load report data.');
    } finally {
      setIsLoading(false);
    }
  }, [activeBranchId, range, slot, sort]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  const rows = useMemo(() => {
    const term = search.trim().toLowerCase();
    if (!data) return [];
    return term
      ? data.rows.filter((r) => r.item_name.toLowerCase().includes(term) || (r.course ?? '').toLowerCase().includes(term))
      : data.rows;
  }, [data, search]);

  const columns = useMemo<DataTableColumn<MovementRow>[]>(() => {
    const slotColumns: DataTableColumn<MovementRow>[] = slot
      ? []
      : (data?.slot_defs ?? []).map((s) => ({
          key: s.key,
          header: s.label,
          align: 'right',
          render: (r: MovementRow) =>
            r[s.key] ? (
              <span style={{ color: MEAL_SLOT_STYLE[s.key].color }} className="font-medium">
                {formatQty(r[s.key])}
              </span>
            ) : (
              <span className="text-muted-foreground">—</span>
            ),
        }));
    return [
      { key: 'rank', header: '#', align: 'right' },
      { key: 'item_name', header: 'Item' },
      { key: 'course', header: 'Category', render: (r) => r.course ?? '—' },
      { key: 'qty', header: 'Qty', align: 'right', render: (r) => <span className="font-medium">{formatQty(r.qty)}</span> },
      { key: 'amount', header: 'Sales', align: 'right', render: (r) => formatCurrency(r.amount) },
      { key: 'bills', header: 'Bills', align: 'right' },
      { key: 'pct_qty', header: '% of Qty', align: 'right', render: (r) => `${r.pct_qty}%` },
      { key: 'avg_qty_per_day', header: 'Avg / Day', align: 'right' },
      ...slotColumns,
      { key: 'last_sold', header: 'Last Sold', render: (r) => r.last_sold ?? <span className="text-red-600">Not sold</span> },
    ];
  }, [data, slot]);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-xl font-semibold">Item Movement</h1>
          <p className="text-sm text-muted-foreground">
            Fast and slow moving items by meal slot {activeBranchId === 'all' ? '· All Branches' : ''}
          </p>
        </div>
        <div className="flex items-center gap-3 flex-wrap">
          <input
            type="text"
            placeholder="Search items..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="border border-input rounded-md px-3 py-1.5 text-sm w-40"
          />
          <div className="w-44">
            <SearchableSelect
              id="item-movement-slot"
              value={slot}
              onChange={(_, val) => setSlot(val as MealSlotKey | '')}
              options={[
                { value: '', label: 'All slots' },
                ...MEAL_SLOT_KEYS.map((key) => ({
                  value: key,
                  label: data?.slot_defs.find((s) => s.key === key)?.label ?? key,
                })),
              ]}
              strict
            />
          </div>
          <div className="w-44">
            <SearchableSelect
              id="item-movement-sort"
              value={sort}
              onChange={(_, val) => setSort(val as SortMode)}
              options={SORT_OPTIONS}
              strict
            />
          </div>
          <DateRangeFilter value={range} onChange={setRange} />
        </div>
      </div>

      {error && (
        <div className="rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div>
      )}

      {isLoading && !data ? (
        <div className="text-sm text-muted-foreground">Loading...</div>
      ) : data ? (
        <>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            <StatCard
              label="Top Mover"
              value={data.summary.top_item ?? '—'}
              delta={data.summary.top_item ? { value: `${formatQty(data.summary.top_item_qty)} sold`, direction: 'up' } : undefined}
              icon={<TrendingUp className="w-4 h-4" />}
            />
            <StatCard label="Items Sold" value={data.summary.items_sold} icon={<Package className="w-4 h-4" />} />
            <StatCard
              label="Not Sold"
              value={data.summary.items_not_sold}
              delta={{ value: 'on the menu, no sales', direction: 'flat' }}
              icon={<Ban className="w-4 h-4" />}
            />
            <StatCard
              label="Total Sales"
              value={formatCurrency(data.summary.total_amount)}
              delta={{ value: `${formatQty(data.summary.total_qty)} qty`, direction: 'flat' }}
              icon={<IndianRupee className="w-4 h-4" />}
            />
          </div>

          {data.summary.items_sold === 0 && <NoSales from={range.from} to={range.to} />}
          <DataTable columns={columns} rows={rows} isLoading={isLoading} emptyMessage="No items match." />
        </>
      ) : null}
    </div>
  );
}
