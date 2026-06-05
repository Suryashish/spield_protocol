import React from 'react';

interface CreaseBg2Props {
  children?: React.ReactNode;
  style?: React.CSSProperties;
}

const CreaseBg2: React.FC<CreaseBg2Props> = ({ children, style }) => {
  return (
    <div style={{
      position: "relative",
      width: "100%",
      background: "transparent",
      borderRadius: 16,
      overflow: "hidden",
      minHeight: 380,
      ...style,
    }}>
      <svg
        style={{ position: "absolute", inset: 0, width: "100%", height: "100%" }}
        viewBox="0 0 680 380"
        xmlns="http://www.w3.org/2000/svg"
        aria-hidden="true"
        preserveAspectRatio="xMidYMid slice"
      >
        <defs>
          <filter id="deepBloom2" x="-40%" y="-120%" width="180%" height="340%">
            <feGaussianBlur stdDeviation="8"/>
          </filter>
          <filter id="midBloom2" x="-25%" y="-100%" width="150%" height="300%">
            <feGaussianBlur stdDeviation="3"/>
          </filter>
          <filter id="softEdge2" x="-10%" y="-80%" width="120%" height="260%">
            <feGaussianBlur stdDeviation="1" result="b1"/>
            <feGaussianBlur stdDeviation="3" result="b2" in="SourceGraphic"/>
            <feMerge>
              <feMergeNode in="b2"/>
              <feMergeNode in="b2"/>
              <feMergeNode in="b1"/>
              <feMergeNode in="SourceGraphic"/>
            </feMerge>
          </filter>
          <filter id="hairGlow2" x="-6%" y="-60%" width="112%" height="220%">
            <feGaussianBlur stdDeviation="0.5"/>
            <feMerge>
              <feMergeNode/>
              <feMergeNode in="SourceGraphic"/>
            </feMerge>
          </filter>
          <linearGradient id="upperGrad2" x1="0%" y1="0%" x2="100%" y2="0%">
            <stop offset="0%"   stopColor="#1fffd0" stopOpacity="0"/>
            <stop offset="15%"  stopColor="#1fffd0" stopOpacity="0.15"/>
            <stop offset="50%"  stopColor="#a0fff0" stopOpacity="0.25"/>
            <stop offset="85%"  stopColor="#1fffd0" stopOpacity="0.15"/>
            <stop offset="100%" stopColor="#1fffd0" stopOpacity="0"/>
          </linearGradient>
          <linearGradient id="lowerGrad2" x1="0%" y1="0%" x2="100%" y2="0%">
            <stop offset="0%"   stopColor="#1fffd0" stopOpacity="0"/>
            <stop offset="15%"  stopColor="#0fffe0" stopOpacity="0.1"/>
            <stop offset="50%"  stopColor="#1fffd0" stopOpacity="0.2"/>
            <stop offset="85%"  stopColor="#0fffe0" stopOpacity="0.1"/>
            <stop offset="100%" stopColor="#1fffd0" stopOpacity="0"/>
          </linearGradient>
          <linearGradient id="bloomH2" x1="0%" y1="0%" x2="100%" y2="0%">
            <stop offset="0%"   stopColor="#1fffd0" stopOpacity="0"/>
            <stop offset="50%"  stopColor="#1fffd0" stopOpacity="0.06"/>
            <stop offset="100%" stopColor="#1fffd0" stopOpacity="0"/>
          </linearGradient>
          <linearGradient id="upperFace2" x1="0%" y1="0%" x2="0%" y2="100%">
            <stop offset="0%"   stopColor="#071a15" stopOpacity="0"/>
            <stop offset="100%" stopColor="#0c2a22" stopOpacity="0.15"/>
          </linearGradient>
          <linearGradient id="lowerFace2" x1="0%" y1="0%" x2="0%" y2="100%">
            <stop offset="0%"   stopColor="#0c2a22" stopOpacity="0.15"/>
            <stop offset="100%" stopColor="#071a15" stopOpacity="0"/>
          </linearGradient>
          <radialGradient id="centerFog2" cx="50%" cy="50%" r="50%">
            <stop offset="0%"   stopColor="#0fffe0" stopOpacity="0.015"/>
            <stop offset="55%"  stopColor="#0aad85" stopOpacity="0.005"/>
            <stop offset="100%" stopColor="#030b09" stopOpacity="0"/>
          </radialGradient>
          <radialGradient id="halo2" cx="50%" cy="50%" r="50%">
            <stop offset="0%"   stopColor="#1fffd0" stopOpacity="0.02"/>
            <stop offset="100%" stopColor="#1fffd0" stopOpacity="0"/>
          </radialGradient>
        </defs>

        <ellipse cx="340" cy="190" rx="340" ry="160" fill="url(#centerFog2)"/>
        <ellipse cx="340" cy="190" rx="200" ry="80"  fill="url(#halo2)"/>

        {/* Upper curve */}
        <path d="M0,0 L680,0 L680,75 Q510,75 340,186 Q170,75 0,75 Z" fill="url(#upperFace2)"/>
        <path d="M0,75 Q170,186 340,186 Q510,186 680,75" fill="none" stroke="url(#bloomH2)" strokeWidth="60" strokeLinecap="round" filter="url(#deepBloom2)"/>
        <path d="M0,75 Q170,186 340,186 Q510,186 680,75" fill="none" stroke="url(#bloomH2)" strokeWidth="30" strokeLinecap="round" filter="url(#midBloom2)"/>
        <path d="M0,75 Q170,186 340,186 Q510,186 680,75" fill="none" stroke="url(#upperGrad2)" strokeWidth="2.5" strokeLinecap="round" filter="url(#softEdge2)"/>
        <path d="M0,75 Q170,186 340,186 Q510,186 680,75" fill="none" stroke="url(#upperGrad2)" strokeWidth="0.8" strokeLinecap="round" filter="url(#hairGlow2)"/>

        {/* Lower curve */}
        <path d="M0,380 L680,380 L680,305 Q510,305 340,194 Q170,305 0,305 Z" fill="url(#lowerFace2)"/>
        <path d="M0,305 Q170,194 340,194 Q510,194 680,305" fill="none" stroke="url(#bloomH2)" strokeWidth="50" strokeLinecap="round" filter="url(#deepBloom2)"/>
        <path d="M0,305 Q170,194 340,194 Q510,194 680,305" fill="none" stroke="url(#bloomH2)" strokeWidth="24" strokeLinecap="round" filter="url(#midBloom2)"/>
        <path d="M0,305 Q170,194 340,194 Q510,194 680,305" fill="none" stroke="url(#lowerGrad2)" strokeWidth="2.5" strokeLinecap="round" filter="url(#softEdge2)"/>
        <path d="M0,305 Q170,194 340,194 Q510,194 680,305" fill="none" stroke="url(#lowerGrad2)" strokeWidth="0.8" strokeLinecap="round" filter="url(#hairGlow2)"/>

        {/* Waist pinch glow */}
        <ellipse cx="340" cy="190" rx="80" ry="22" fill="#1fffd0" fillOpacity="0.01" filter="url(#deepBloom2)"/>
        <ellipse cx="340" cy="190" rx="30" ry="10" fill="#1fffd0" fillOpacity="0.04" filter="url(#midBloom2)"/>
      </svg>

      {children && (
        <div style={{ position: "relative", zIndex: 10 }}>
          {children}
        </div>
      )}
    </div>
  );
}

export default CreaseBg2;
