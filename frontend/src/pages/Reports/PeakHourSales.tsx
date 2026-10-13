import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { call, formatCompactCurrency, formatCurrency } from '@ury/core';
import { Card, CardContent, CardHeader, CardTitle, StatCard, cn } from '@ury/ui';
import { CalendarDays, Clock, IndianRupee, Receipt, Trophy } from 'lucide-react';
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Legend,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { startOfDay, subDays, endOfDay, format } from 'date-fns';
import { useBranchContext } from '../../context/BranchContext';
import { DateRangeFilter, type DateRangeValue } from '../../components/reports/DateRangeFilter';
import { PieChartCard } from '../../components/reports/charts/PieChartCard';
import { toApiDate } from '../../lib/reportDate';
import { MEAL_SLOT_KEYS, MEAL_SLOT_STYLE, type MealSlotDef, type MealSlotKey } from '../../lib/mealSlots';

interface SlotRow extends MealSlotDef {
  sales: number;
  bills: number;
  qty: number;
  avg_bill: number;
  pct_sales: number;
  avg_daily_sales: number;
  top_item: string | null;
  top_earner: string | null;
}

interface HourRow {
  hour: number;
  label: string;
  slot: MealSlotKey;
  sales: number;
  bills: number;
  avg_daily_sales: number;
}

type SlotAmounts = Record<MealSlotKey, number>;

interface ItemRow extends SlotAmounts {
  item_code: string;
  item_name: string;
  course: string | null;
  qty: number;
  amount: number;
  bills: number;
}

interface SlotItem {
  item_name: string;
  qty: number;
  amount: number;
}

interface PeakHourData {
  slot_defs: MealSlotDef[];
  summary: {
    total_sales: number;
    total_bills: number;
    avg_bill: number;
    items_sold: number;
    days: number;
    avg_daily_sales: number;
    peak_slot: string | null;
    peak_slot_sales: number;
    peak_hour: string | null;
    peak_hour_sales: number;
    busiest_weekday: string | null;
  };
  slots: SlotRow[];
  hourly: HourRow[];
  daily: Array<SlotAmounts & { date: string; label: string; total: number }>;
  weekday: Array<SlotAmounts & { weekday: string; days: number; total: number }>;
  top_items: ItemRow[];
  top_earners: ItemRow[];
  top_by_slot: Record<MealSlotKey, { by_qty: SlotItem[]; by_sales: SlotItem[] }>;
  order_types: Array<{ order_type: string; bills: number; sales: number }>;
}

const formatQty = (qty: number) => (Number.isInteger(qty) ? String(qty) : qty.toFixed(2));

export function PeakHourSales() {
  const { activeBranchId } = useBranchContext();
  const [range, setRange] = useState<DateRangeValue>(() => ({
    from: startOfDay(subDays(new Date(), 29)),
    to: endOfDay(new Date()),
  }));
  const [slotItemsBy, setSlotItemsBy] = useState<'by_qty' | 'by_sales'>('by_sales');
  const [data, setData] = useState<PeakHourData | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchData = useCallback(async () => {
    setIsLoading(true);
    try {
      setError(null);
      const branch = activeBranchId === 'all' ? undefined : activeBranchId;
      const res = await call<{ message: PeakHourData }>('ury.ury.report_api.peak_hours.get_peak_hour_sales', {
        branch,
        start_date: toApiDate(range.from),
        end_date: toApiDate(range.to),
      });
      setData(res.message ?? (res as unknown as PeakHourData));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load report data.');
    } finally {
      setIsLoading(false);
    }
  }, [activeBranchId, range]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  const slotLabel = (key: MealSlotKey) => data?.slot_defs.find((s) => s.key === key)?.label ?? key;
  const weekdayMax = Math.max(1, ...(data?.weekday.flatMap((w) => MEAL_SLOT_KEYS.map((k) => w[k])) ?? [0]));

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-xl font-semibold">Peak Hour Sales</h1>
          <p className="text-sm text-muted-foreground">
            Breakfast, lunch, evening snacks and supper at a glance{' '}
            {activeBranchId === 'all' ? '· All Branches' : ''}
          </p>
        </div>
        <DateRangeFilter value={range} onChange={setRange} />
      </div>

      {error && (
        <div className="rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div>
      )}

      {isLoading && !data ? (
        <div className="text-sm text-muted-foreground">Loading...</div>
      ) : data && data.summary.total_bills === 0 ? (
        <NoSales from={range.from} to={range.to} />
      ) : data ? (
        <>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-4">
            <StatCard
              label="Total Sales"
              value={formatCurrency(data.summary.total_sales)}
              delta={{ value: `${formatCurrency(data.summary.avg_daily_sales)} / day`, direction: 'flat' }}
              icon={<IndianRupee className="w-4 h-4" />}
            />
            <StatCard
              label="Bills"
              value={data.summary.total_bills}
              delta={{ value: `${formatCurrency(data.summary.avg_bill)} avg bill`, direction: 'flat' }}
              icon={<Receipt className="w-4 h-4" />}
            />
            <StatCard
              label="Peak Slot"
              value={data.summary.peak_slot ?? '—'}
              delta={data.summary.peak_slot ? { value: formatCurrency(data.summary.peak_slot_sales), direction: 'up' } : undefined}
              icon={<Trophy className="w-4 h-4" />}
            />
            <StatCard
              label="Peak Hour"
              value={data.summary.peak_hour ?? '—'}
              delta={data.summary.peak_hour ? { value: formatCurrency(data.summary.peak_hour_sales), direction: 'up' } : undefined}
              icon={<Clock className="w-4 h-4" />}
            />
            <StatCard
              label="Busiest Day"
              value={data.summary.busiest_weekday ?? '—'}
              icon={<CalendarDays className="w-4 h-4" />}
            />
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-4">
            {data.slots.map((slot) => {
              const { color, icon: Icon } = MEAL_SLOT_STYLE[slot.key];
              return (
                <Card key={slot.key} className="overflow-hidden">
                  <div className="h-1" style={{ backgroundColor: color }} />
                  <CardContent className="pt-4 space-y-3">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <span className="rounded-md p-1.5" style={{ backgroundColor: `${color}1a`, color }}>
                          <Icon className="w-4 h-4" />
                        </span>
                        <div>
                          <div className="font-semibold">{slot.label}</div>
                          <div className="text-xs text-muted-foreground">{slot.range_label}</div>
                        </div>
                      </div>
                      <span className="text-sm font-medium tabular-nums">{slot.pct_sales}%</span>
                    </div>
                    <div className="text-2xl font-semibold tabular-nums">{formatCurrency(slot.sales)}</div>
                    <div className="h-1.5 rounded-full bg-muted">
                      <div className="h-1.5 rounded-full" style={{ width: `${slot.pct_sales}%`, backgroundColor: color }} />
                    </div>
                    <div className="grid grid-cols-2 gap-2 text-xs">
                      <div>
                        <div className="text-muted-foreground">Bills</div>
                        <div className="font-medium tabular-nums">{slot.bills}</div>
                      </div>
                      <div>
                        <div className="text-muted-foreground">Avg bill</div>
                        <div className="font-medium tabular-nums">{formatCurrency(slot.avg_bill)}</div>
                      </div>
                      <div className="col-span-2">
                        <div className="text-muted-foreground">Top earner</div>
                        <div className="font-medium truncate" title={slot.top_earner ?? ''}>{slot.top_earner ?? '—'}</div>
                      </div>
                      <div className="col-span-2">
                        <div className="text-muted-foreground">Most sold</div>
                        <div className="font-medium truncate" title={slot.top_item ?? ''}>{slot.top_item ?? '—'}</div>
                      </div>
                    </div>
                  </CardContent>
                </Card>
              );
            })}
          </div>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">Sales by Hour</CardTitle>
            </CardHeader>
            <CardContent>
              <ResponsiveContainer width="100%" height={300}>
                <BarChart data={data.hourly}>
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis dataKey="label" interval={1} fontSize={12} />
                  <YAxis tickFormatter={(v) => formatCompactCurrency(Number(v))} width={64} />
                  <Tooltip
                    formatter={(value: number, _name, item) => [
                      `${formatCurrency(value)} · ${(item.payload as HourRow).bills} bills`,
                      slotLabel((item.payload as HourRow).slot),
                    ]}
                  />
                  <Bar dataKey="sales" name="Sales" maxBarSize={36} isAnimationActive={false}>
                    {data.hourly.map((h) => (
                      <Cell key={h.hour} fill={MEAL_SLOT_STYLE[h.slot].color} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
              <div className="flex flex-wrap gap-4 justify-center text-xs mt-2">
                {data.slot_defs.map((s) => (
                  <span key={s.key} className="flex items-center gap-1.5">
                    <span className="w-2.5 h-2.5 rounded-sm" style={{ backgroundColor: MEAL_SLOT_STYLE[s.key].color }} />
                    {s.label} ({s.range_label})
                  </span>
                ))}
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">Daily Sales by Slot</CardTitle>
            </CardHeader>
            <CardContent>
              <ResponsiveContainer width="100%" height={300}>
                <BarChart data={data.daily}>
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis dataKey="label" fontSize={12} />
                  <YAxis tickFormatter={(v) => formatCompactCurrency(Number(v))} width={64} />
                  <Tooltip formatter={(value: number) => formatCurrency(value)} />
                  <Legend />
                  {data.slot_defs.map((s) => (
                    <Bar
                      key={s.key}
                      dataKey={s.key}
                      name={s.label}
                      stackId="slots"
                      fill={MEAL_SLOT_STYLE[s.key].color}
                      maxBarSize={40}
                      isAnimationActive={false}
                    />
                  ))}
                </BarChart>
              </ResponsiveContainer>
            </CardContent>
          </Card>

          <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
            <Card className="lg:col-span-2">
              <CardHeader>
                <CardTitle className="text-base">Busiest Days · average sales per day</CardTitle>
              </CardHeader>
              <CardContent className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-muted-foreground">
                      <th className="text-left font-medium py-2">Day</th>
                      {data.slot_defs.map((s) => (
                        <th key={s.key} className="text-right font-medium py-2 px-2">{s.label}</th>
                      ))}
                      <th className="text-right font-medium py-2">Total</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.weekday.map((w) => (
                      <tr key={w.weekday} className="border-t">
                        <td className="py-2">
                          {w.weekday}
                          <span className="text-xs text-muted-foreground"> ×{w.days}</span>
                        </td>
                        {MEAL_SLOT_KEYS.map((key) => (
                          <td key={key} className="py-1 px-1 text-right tabular-nums">
                            <div
                              className="rounded px-2 py-1"
                              style={{
                                backgroundColor: `${MEAL_SLOT_STYLE[key].color}${Math.round((w[key] / weekdayMax) * 200)
                                  .toString(16)
                                  .padStart(2, '0')}`,
                              }}
                            >
                              {w[key] ? formatCompactCurrency(w[key]) : '—'}
                            </div>
                          </td>
                        ))}
                        <td className="py-2 text-right font-medium tabular-nums">{formatCurrency(w.total)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </CardContent>
            </Card>
            <PieChartCard title="Order Types" data={data.order_types} dataKey="sales" nameKey="order_type" />
          </div>

          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0">
              <CardTitle className="text-base">Top Items per Slot</CardTitle>
              <div className="flex rounded-md border text-xs overflow-hidden">
                {(['by_sales', 'by_qty'] as const).map((mode) => (
                  <button
                    key={mode}
                    onClick={() => setSlotItemsBy(mode)}
                    className={cn('px-3 py-1.5', slotItemsBy === mode ? 'bg-primary text-primary-foreground' : 'bg-background')}
                  >
                    {mode === 'by_sales' ? 'By sales' : 'By quantity'}
                  </button>
                ))}
              </div>
            </CardHeader>
            <CardContent className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-6">
              {data.slot_defs.map((s) => {
                const rows = data.top_by_slot[s.key][slotItemsBy];
                const max = Math.max(1, ...rows.map((r) => (slotItemsBy === 'by_sales' ? r.amount : r.qty)));
                return (
                  <div key={s.key}>
                    <div className="text-sm font-semibold mb-2" style={{ color: MEAL_SLOT_STYLE[s.key].color }}>
                      {s.label}
                    </div>
                    {rows.length === 0 ? (
                      <div className="text-xs text-muted-foreground">No sales</div>
                    ) : (
                      <ol className="space-y-2">
                        {rows.map((r) => {
                          const value = slotItemsBy === 'by_sales' ? r.amount : r.qty;
                          return (
                            <li key={r.item_name} className="text-xs">
                              <div className="flex justify-between gap-2">
                                <span className="truncate" title={r.item_name}>{r.item_name}</span>
                                <span className="tabular-nums shrink-0">
                                  {slotItemsBy === 'by_sales' ? formatCurrency(r.amount) : `${formatQty(r.qty)} sold`}
                                </span>
                              </div>
                              <div className="h-1 mt-1 rounded-full bg-muted">
                                <div
                                  className="h-1 rounded-full"
                                  style={{ width: `${(value / max) * 100}%`, backgroundColor: MEAL_SLOT_STYLE[s.key].color }}
                                />
                              </div>
                            </li>
                          );
                        })}
                      </ol>
                    )}
                  </div>
                );
              })}
            </CardContent>
          </Card>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            <RankedItems title="Most Moving Items" rows={data.top_items} metric="qty" />
            <RankedItems title="Top Earning Items" rows={data.top_earners} metric="amount" />
          </div>
          <div className="text-right">
            <Link to="../item-movement" relative="path" className="text-sm text-primary hover:underline">
              See every item, including slow movers →
            </Link>
          </div>
        </>
      ) : null}
    </div>
  );
}

export function NoSales({ from, to }: { from: Date; to: Date }) {
  return (
    <div className="rounded-md border border-amber-200 bg-amber-50 px-4 py-6 text-center text-sm text-amber-800">
      No sales between {format(from, 'd MMM yyyy')} and {format(to, 'd MMM yyyy')}. Pick a different date range.
    </div>
  );
}

function RankedItems({ title, rows, metric }: { title: string; rows: ItemRow[]; metric: 'qty' | 'amount' }) {
  const max = Math.max(1, ...rows.map((r) => r[metric]));
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">{title}</CardTitle>
      </CardHeader>
      <CardContent>
        {rows.length === 0 ? (
          <div className="text-sm text-muted-foreground">No sales in this period.</div>
        ) : (
          <ol className="space-y-3">
            {rows.map((r, i) => (
              <li key={r.item_code} className="text-sm">
                <div className="flex justify-between gap-3">
                  <span className="truncate">
                    <span className="text-muted-foreground tabular-nums mr-2">{i + 1}.</span>
                    {r.item_name}
                  </span>
                  <span className="tabular-nums shrink-0 font-medium">
                    {metric === 'qty' ? `${formatQty(r.qty)} sold` : formatCurrency(r.amount)}
                  </span>
                </div>
                <div className="flex h-1.5 mt-1 rounded-full bg-muted overflow-hidden" style={{ width: `${(r[metric] / max) * 100}%` }}>
                  {MEAL_SLOT_KEYS.map((key) => (
                    <div
                      key={key}
                      style={{
                        width: `${r.qty ? (r[key] / r.qty) * 100 : 0}%`,
                        backgroundColor: MEAL_SLOT_STYLE[key].color,
                      }}
                    />
                  ))}
                </div>
              </li>
            ))}
          </ol>
        )}
        <p className="text-xs text-muted-foreground mt-3">Bar colours show how each item’s quantity splits across the slots.</p>
      </CardContent>
    </Card>
  );
}
