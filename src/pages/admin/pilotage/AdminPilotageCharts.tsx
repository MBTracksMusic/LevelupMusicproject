import { Card } from '../../../components/ui/Card';
import { useTranslation } from '../../../lib/i18n';
import type { AdminMetricsTimeseries, MetricsTimeseriesPoint } from './types';

interface AdminPilotageChartsProps {
  timeseries: AdminMetricsTimeseries;
}

const SVG_WIDTH = 900;
const SVG_HEIGHT = 260;
const SVG_PADDING = 24;

function buildPolyline(points: MetricsTimeseriesPoint[]) {
  if (points.length === 0) return '';

  const values = points.map((point) => point.value);
  const min = Math.min(...values);
  const max = Math.max(...values);
  const range = max - min;
  const safeRange = range === 0 ? 1 : range;
  const width = SVG_WIDTH - SVG_PADDING * 2;
  const height = SVG_HEIGHT - SVG_PADDING * 2;

  return points
    .map((point, index) => {
      const x = SVG_PADDING + (index * width) / Math.max(points.length - 1, 1);
      const normalized = (point.value - min) / safeRange;
      const y = SVG_HEIGHT - SVG_PADDING - normalized * height;
      return `${x},${y}`;
    })
    .join(' ');
}

interface ChartCardProps {
  title: string;
  subtitle: string;
  points: MetricsTimeseriesPoint[];
  strokeColor: string;
}

function formatDateLabel(date: string) {
  return date.slice(5);
}

function ChartCard({ title, subtitle, points, strokeColor }: ChartCardProps) {
  const { t } = useTranslation();
  const polyline = buildPolyline(points);
  const firstLabel = points[0]?.date ? formatDateLabel(points[0].date) : '';
  const midLabel = points[Math.floor(points.length / 2)]?.date
    ? formatDateLabel(points[Math.floor(points.length / 2)].date)
    : '';
  const lastLabel = points[points.length - 1]?.date ? formatDateLabel(points[points.length - 1].date) : '';

  return (
    <Card className="p-4 sm:p-5 border-zinc-800">
      <h3 className="text-sm font-semibold text-zinc-200 uppercase tracking-[0.08em]">{title}</h3>
      <p className="text-zinc-500 text-xs mt-1">{subtitle}</p>
      <div className="h-72 mt-4 rounded-lg border border-zinc-800 bg-zinc-950/60 p-3">
        {points.length === 0 ? (
          <div className="h-full flex items-center justify-center text-xs text-zinc-500">
            {t('admin.pilotage.chartNoData')}
          </div>
        ) : (
          <div className="h-full flex flex-col">
            <svg
              viewBox={`0 0 ${SVG_WIDTH} ${SVG_HEIGHT}`}
              preserveAspectRatio="none"
              className="flex-1 w-full"
              aria-label={t('admin.pilotage.chartAria', { title })}
            >
              <rect x="0" y="0" width={SVG_WIDTH} height={SVG_HEIGHT} fill="transparent" />
              <polyline
                fill="none"
                stroke={strokeColor}
                strokeWidth="3"
                strokeLinejoin="round"
                strokeLinecap="round"
                points={polyline}
              />
            </svg>
            <div className="mt-2 flex items-center justify-between text-[11px] text-zinc-500">
              <span>{firstLabel}</span>
              <span>{midLabel}</span>
              <span>{lastLabel}</span>
            </div>
          </div>
        )}
      </div>
    </Card>
  );
}

export function AdminPilotageCharts({ timeseries }: AdminPilotageChartsProps) {
  const { t } = useTranslation();
  return (
    <div className="grid grid-cols-1 xl:grid-cols-3 gap-4">
      <ChartCard
        title={t('admin.pilotage.usersChartTitle')}
        subtitle={t('admin.pilotage.usersChartSubtitle')}
        points={timeseries.users_30d}
        strokeColor="#22c55e"
      />
      <ChartCard
        title={t('admin.pilotage.revenueChartTitle')}
        subtitle={t('admin.pilotage.revenueChartSubtitle')}
        points={timeseries.revenue_30d}
        strokeColor="#f97316"
      />
      <ChartCard
        title={t('admin.pilotage.beatsChartTitle')}
        subtitle={t('admin.pilotage.beatsChartSubtitle')}
        points={timeseries.beats_30d}
        strokeColor="#3b82f6"
      />
    </div>
  );
}
