import beatelionIcon from '../../assets/beatelion-icon.svg';

interface LogoLoaderProps {
  className?: string;
  label?: string;
  iconClassName?: string;
}

const waveHeights = [12, 18, 24, 18, 12];

export function LogoLoader({
  className = '',
  label = 'Loading...',
  iconClassName = 'h-12 w-12',
}: LogoLoaderProps) {
  return (
    <div className={`flex flex-col items-center justify-center gap-4 ${className}`.trim()}>
      <img
        src={beatelionIcon}
        alt="Beatelion - Beat marketplace"
        className={`${iconClassName} brand-logo-pulse`.trim()}
      />

      <div className="flex items-end gap-1.5 h-6" aria-hidden="true">
        {waveHeights.map((height, index) => (
          <span
            key={`${height}-${index}`}
            className="brand-wave w-1 rounded-full"
            style={{
              height: `${height}px`,
              animationDelay: `${index * 120}ms`,
              background:
                'linear-gradient(180deg, #FF8A3D 0%, #FF6A2B 55%, #FF4D4D 100%)',
              boxShadow: '0 0 10px rgba(255, 106, 43, 0.55)',
            }}
          />
        ))}
      </div>

      <p className="text-zinc-400 text-sm tracking-wide">{label}</p>
    </div>
  );
}

