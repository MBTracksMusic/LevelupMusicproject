import { useId, useMemo } from 'react';

export type BattleScoreRadarVariant = 'primary' | 'secondary';

export interface BattleScoreRadarScores {
  artistic: number;
  coherence: number;
  credibility: number;
  preference: number;
}

export interface BattleScoreRadarI18n {
  /** Short label rendered inside the SVG (3-4 chars to avoid viewBox clipping). */
  artistic?: string;
  coherence?: string;
  credibility?: string;
  preference?: string;
  /** Full names surfaced via hover tooltip + a11y description. */
  artisticFull?: string;
  coherenceFull?: string;
  credibilityFull?: string;
  preferenceFull?: string;
  insufficientData?: string;
  credibilityCalibrating?: string;
}

export interface BattleScoreRadarProps {
  scores: BattleScoreRadarScores;
  max?: number;
  size?: number;
  variant?: BattleScoreRadarVariant;
  coherenceDataSufficient?: boolean;
  credibilityDynamic?: boolean;
  i18n?: BattleScoreRadarI18n;
  className?: string;
  /** Accessible label for screen readers. */
  ariaLabel?: string;
}

const DEFAULT_I18N: Required<BattleScoreRadarI18n> = {
  artistic: 'Art',
  coherence: 'Coh',
  credibility: 'Cred',
  preference: 'Pref',
  artisticFull: 'Artistique',
  coherenceFull: 'Cohérence',
  credibilityFull: 'Crédibilité',
  preferenceFull: 'Préférence',
  insufficientData: 'Données insuffisantes',
  credibilityCalibrating: 'Indicateur en cours de calibrage',
};

const FULL_KEY: Record<AxisKey, keyof Pick<Required<BattleScoreRadarI18n>, 'artisticFull' | 'coherenceFull' | 'credibilityFull' | 'preferenceFull'>> = {
  artistic: 'artisticFull',
  coherence: 'coherenceFull',
  credibility: 'credibilityFull',
  preference: 'preferenceFull',
};

const GRID_LEVELS = [0.25, 0.5, 0.75, 1];

type AxisKey = keyof BattleScoreRadarScores;
const AXIS_ORDER: { key: AxisKey; angleDeg: number }[] = [
  { key: 'artistic',    angleDeg: -90 }, // top
  { key: 'coherence',   angleDeg:   0 }, // right
  { key: 'credibility', angleDeg:  90 }, // bottom
  { key: 'preference',  angleDeg: 180 }, // left
];

export function BattleScoreRadar({
  scores,
  max = 100,
  size = 240,
  variant = 'primary',
  coherenceDataSufficient = true,
  credibilityDynamic = false,
  i18n,
  className,
  ariaLabel,
}: BattleScoreRadarProps) {
  const labels = { ...DEFAULT_I18N, ...i18n };
  const uid = useId();

  const cx = size / 2;
  const cy = size / 2;
  // Reserve outer ring for labels (~18% radius padding keeps axis labels inside the viewBox).
  const radius = size / 2 - size * 0.18;

  const polar = (ratio: number, angleDeg: number): [number, number] => {
    const rad = (angleDeg * Math.PI) / 180;
    return [cx + radius * ratio * Math.cos(rad), cy + radius * ratio * Math.sin(rad)];
  };

  const polygonPoints = useMemo(
    () =>
      AXIS_ORDER
        .map(({ key, angleDeg }) => polar(Math.max(0, Math.min(1, scores[key] / max)), angleDeg).join(','))
        .join(' '),
    // polar/cx/cy/radius are stable for a given size, so we only need to invalidate on scores/max
    [scores, max], // eslint-disable-line react-hooks/exhaustive-deps
  );

  const strokeVar = variant === 'primary' ? 'var(--brand-primary)' : 'var(--brand-secondary)';

  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width={size}
      height={size}
      viewBox={`0 0 ${size} ${size}`}
      className={className}
      role="img"
      aria-label={ariaLabel ?? 'Battle quality radar'}
    >
      {/* ─── Grid: concentric circles ─────────────────────────────────────── */}
      {GRID_LEVELS.map((level) => (
        <circle
          key={`grid-${level}`}
          cx={cx}
          cy={cy}
          r={radius * level}
          fill="none"
          stroke="rgb(63 63 70)"
          strokeWidth={1}
        />
      ))}

      {/* ─── Grid: radial spokes ──────────────────────────────────────────── */}
      {AXIS_ORDER.map(({ key, angleDeg }) => {
        const [x2, y2] = polar(1, angleDeg);
        return (
          <line
            key={`spoke-${key}`}
            x1={cx}
            y1={cy}
            x2={x2}
            y2={y2}
            stroke="rgb(63 63 70)"
            strokeWidth={1}
          />
        );
      })}

      {/* ─── Score polygon ────────────────────────────────────────────────── */}
      <polygon
        points={polygonPoints}
        fill={strokeVar}
        fillOpacity={0.25}
        stroke={strokeVar}
        strokeWidth={2}
        strokeLinejoin="round"
      />

      {/* ─── Axis labels + tooltips ───────────────────────────────────────── */}
      {AXIS_ORDER.map(({ key, angleDeg }) => {
        const [lx, ly] = polar(1.18, angleDeg);
        // Text-anchor: pick based on angle so labels sit naturally around the radar.
        const anchor =
          angleDeg === -90 ? 'middle' :
          angleDeg ===  90 ? 'middle' :
          angleDeg ===   0 ? 'start'  :
                             'end';
        // Baseline: nudge top/bottom labels so they don't clip the radar.
        const dy =
          angleDeg === -90 ? -4 :
          angleDeg ===  90 ? 14 :
                              4;

        const isCoherence = key === 'coherence';
        const isCredibility = key === 'credibility';
        const warning =
          isCoherence && !coherenceDataSufficient ? labels.insufficientData :
          isCredibility && !credibilityDynamic ? labels.credibilityCalibrating :
          undefined;

        // Warning = amber (data missing). Info = zinc (static metric, not yet dynamic).
        const dotColor =
          isCoherence && !coherenceDataSufficient ? 'rgb(245 158 11)' /* amber-500 */ :
          isCredibility && !credibilityDynamic ? 'rgb(113 113 122)' /* zinc-500 */ :
          undefined;

        const fullName = labels[FULL_KEY[key]];
        const tooltip = warning ? `${fullName} — ${warning}` : fullName;
        const dotRadius = Math.max(3, size * 0.018);
        // Position the status dot a bit to the right of the (short) label.
        const labelWidth = Math.max(10, size * 0.052) * (labels[key].length * 0.6);
        const dotDx =
          anchor === 'start' ? labelWidth + dotRadius * 1.5 :
          anchor === 'end' ? -(labelWidth + dotRadius * 1.5) :
                              labelWidth / 2 + dotRadius * 1.5;

        return (
          <g key={`label-${key}`}>
            <title>{tooltip}</title>
            <text
              x={lx}
              y={ly + dy}
              textAnchor={anchor}
              fill="rgb(212 212 216)"
              fontSize={Math.max(10, size * 0.052)}
              fontFamily="inherit"
              fontWeight={500}
              style={{ cursor: 'help' }}
            >
              {labels[key]}
            </text>
            {dotColor && (
              <circle
                cx={lx + dotDx}
                cy={ly + dy - dotRadius}
                r={dotRadius}
                fill={dotColor}
                stroke="rgb(24 24 27)"
                strokeWidth={1}
              >
                <title>{warning}</title>
              </circle>
            )}
          </g>
        );
      })}

      {/* ─── Anchor for label-of-label associations (a11y) ────────────────── */}
      <desc id={`${uid}-desc`}>
        Artistic {scores.artistic}/{max}, Coherence {scores.coherence}/{max}
        {!coherenceDataSufficient ? ` (${labels.insufficientData})` : ''},
        Credibility {scores.credibility}/{max}
        {!credibilityDynamic ? ` (${labels.credibilityCalibrating})` : ''},
        Preference {scores.preference}/{max}.
      </desc>
    </svg>
  );
}
