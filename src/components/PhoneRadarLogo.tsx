import React from 'react';

interface PhoneRadarLogoProps {
  className?: string;
  isListening?: boolean;
}

export const PhoneRadarLogo: React.FC<PhoneRadarLogoProps> = ({
  className = 'w-11 h-11',
  isListening = false,
}) => {
  return (
    <div className={`relative flex items-center justify-center shrink-0 ${className}`}>
      <svg
        viewBox="0 0 64 64"
        fill="none"
        xmlns="http://www.w3.org/2000/svg"
        className="w-full h-full drop-shadow-md"
      >
        <defs>
          {/* Bezel Gradient */}
          <linearGradient id="phoneBorderGrad" x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" stopColor="#38bdf8" />
            <stop offset="50%" stopColor="#6366f1" />
            <stop offset="100%" stopColor="#a855f7" />
          </linearGradient>

          {/* Screen Background Gradient */}
          <linearGradient id="phoneScreenGrad" x1="0%" y1="0%" x2="0%" y2="100%">
            <stop offset="0%" stopColor="#0b172a" />
            <stop offset="100%" stopColor="#020617" />
          </linearGradient>

          {/* Radar Sweep Arc */}
          <linearGradient id="miniRadarSweep" x1="0%" y1="100%" x2="100%" y2="0%">
            <stop offset="0%" stopColor="#00f0ff" stopOpacity="0" />
            <stop offset="100%" stopColor="#00f0ff" stopOpacity="0.45" />
          </linearGradient>
        </defs>

        {/* Outer Emitted Waves (Top Antenna Radar Waves) */}
        <g strokeLinecap="round">
          <path
            d="M 23 8 A 14 14 0 0 1 41 8"
            stroke="#38bdf8"
            strokeWidth="1.5"
            strokeOpacity={isListening ? '0.9' : '0.4'}
            className={isListening ? 'animate-pulse' : ''}
          />
          <path
            d="M 27 11 A 8 8 0 0 1 37 11"
            stroke="#00f0ff"
            strokeWidth="1.5"
            strokeOpacity={isListening ? '1' : '0.6'}
          />
        </g>

        {/* Smartphone Outer Bezel (Bentuk HP) */}
        <rect
          x="18"
          y="13"
          width="28"
          height="46"
          rx="6"
          fill="#0f172a"
          stroke="url(#phoneBorderGrad)"
          strokeWidth="1.8"
        />

        {/* Smartphone Screen */}
        <rect
          x="20.5"
          y="16.5"
          width="23"
          height="39"
          rx="4"
          fill="url(#phoneScreenGrad)"
        />

        {/* Phone Speaker Notch */}
        <rect
          x="28.5"
          y="18"
          width="7"
          height="1.5"
          rx="0.75"
          fill="#475569"
        />

        {/* RADAR SYMBOL ON SCREEN (Simbol Radar) */}
        <g transform="translate(32, 36)">
          {/* Radar Grid Crosshairs */}
          <line x1="-8.5" y1="0" x2="8.5" y2="0" stroke="#38bdf8" strokeWidth="0.6" strokeOpacity="0.3" />
          <line x1="0" y1="-8.5" x2="0" y2="8.5" stroke="#38bdf8" strokeWidth="0.6" strokeOpacity="0.3" />

          {/* Concentric Radar Rings */}
          <circle cx="0" cy="0" r="8.5" fill="none" stroke="#38bdf8" strokeWidth="0.8" strokeOpacity="0.4" />
          <circle cx="0" cy="0" r="5.5" fill="none" stroke="#38bdf8" strokeWidth="0.9" strokeOpacity="0.6" />
          <circle cx="0" cy="0" r="2.8" fill="none" stroke="#00f0ff" strokeWidth="1" strokeOpacity="0.85" />

          {/* Radar Sweep Wedge */}
          <path
            d="M 0 0 L 7.5 -3.5 A 8.5 8.5 0 0 0 0 -8.5 Z"
            fill="url(#miniRadarSweep)"
            className={isListening ? 'origin-center animate-spin' : ''}
            style={isListening ? { animationDuration: '3s' } : undefined}
          />

          {/* Radar Sweep Line */}
          <line
            x1="0"
            y1="0"
            x2="7.5"
            y2="-3.5"
            stroke="#00f0ff"
            strokeWidth="0.8"
            className={isListening ? 'origin-center animate-spin' : ''}
            style={isListening ? { animationDuration: '3s' } : undefined}
          />

          {/* Center Emitter Dot */}
          <circle cx="0" cy="0" r="1" fill="#ffffff" />

          {/* Target Detected Blip Dot (Green Ping) */}
          <circle cx="4" cy="-3.5" r="1.3" fill="#34d399" />
          <circle cx="4" cy="-3.5" r="0.6" fill="#ffffff" />
        </g>

        {/* Phone Bottom Home Bar */}
        <rect
          x="27"
          y="52"
          width="10"
          height="1"
          rx="0.5"
          fill="#475569"
        />
      </svg>

      {/* Online / Active status pulse indicator */}
      {isListening && (
        <span className="absolute -bottom-0.5 -right-0.5 flex h-3 w-3">
          <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75" />
          <span className="relative inline-flex rounded-full h-3 w-3 bg-emerald-500 border-2 border-slate-900" />
        </span>
      )}
    </div>
  );
};
