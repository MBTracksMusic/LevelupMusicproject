import { AlertOctagon, AlertTriangle } from 'lucide-react';
import { Button } from '../ui/Button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../ui/Card';
import type { AnalyticsAlertRecord } from '../../lib/analyticsAlertsService';

interface AnalyticsAlertsPanelProps {
  alerts: AnalyticsAlertRecord[];
  isLoading: boolean;
  error: string | null;
  onResolve: (id: string) => void;
  resolvingId: string | null;
}

function formatTimestamp(value: string) {
  return new Date(value).toLocaleString();
}

export function AnalyticsAlertsPanel({
  alerts,
  isLoading,
  error,
  onResolve,
  resolvingId,
}: AnalyticsAlertsPanelProps) {
  return (
    <Card className="md:col-span-2 border-zinc-800">
      <CardHeader>
        <CardTitle>Alertes analytics</CardTitle>
        <CardDescription>
          Monitoring business persistant avec résolution manuelle côté admin.
        </CardDescription>
      </CardHeader>
      <CardContent>
        {error ? (
          <p className="text-sm text-red-400">{error}</p>
        ) : isLoading ? (
          <p className="text-sm text-zinc-400">Chargement des alertes...</p>
        ) : alerts.length === 0 ? (
          <p className="text-sm text-zinc-400">Aucune alerte active.</p>
        ) : (
          <div className="space-y-3">
            {alerts.map((alert) => {
              const isCritical = alert.type === 'critical';

              return (
                <div
                  key={alert.id}
                  className={`rounded-xl border px-4 py-4 ${
                    isCritical
                      ? 'border-red-500/30 bg-red-500/5'
                      : 'border-amber-500/30 bg-amber-500/5'
                  }`}
                >
                  <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        {isCritical ? (
                          <AlertOctagon className="h-4 w-4 text-red-300" />
                        ) : (
                          <AlertTriangle className="h-4 w-4 text-amber-300" />
                        )}
                        <span
                          className={`text-xs font-semibold uppercase tracking-[0.12em] ${
                            isCritical ? 'text-red-200' : 'text-amber-200'
                          }`}
                        >
                          {alert.type}
                        </span>
                      </div>
                      <p className="mt-2 text-sm font-medium text-white">{alert.message}</p>
                      <p className="mt-1 text-xs text-zinc-400">
                        {formatTimestamp(alert.created_at)}
                      </p>
                    </div>
                    <Button
                      variant="outline"
                      onClick={() => onResolve(alert.id)}
                      isLoading={resolvingId === alert.id}
                      disabled={resolvingId !== null}
                    >
                      Marquer comme résolu
                    </Button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
