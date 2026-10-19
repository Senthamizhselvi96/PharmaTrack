export default function PharmacyHeroIllustration() {
  return (
    <div className="hero-illustration-wrapper">
      <svg
        viewBox="0 0 540 370"
        width="100%"
        height="100%"
        fill="none"
        xmlns="http://www.w3.org/2000/svg"
        className="hero-svg"
        role="img"
        aria-label="PharmaTrack real-time pharmacy search and medicine reservation illustration"
      >
        <defs>
          <linearGradient id="bgGrad" x1="0" y1="0" x2="540" y2="370" gradientUnits="userSpaceOnUse">
            <stop offset="0%" stopColor="#f4faf7" />
            <stop offset="100%" stopColor="#eaf5f0" />
          </linearGradient>

          <linearGradient id="pinGrad" x1="50" y1="90" x2="130" y2="250" gradientUnits="userSpaceOnUse">
            <stop offset="0%" stopColor="#0f6655" />
            <stop offset="100%" stopColor="#0b4e42" />
          </linearGradient>

          <linearGradient id="capsuleTeal" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0%" stopColor="#10b981" />
            <stop offset="100%" stopColor="#059669" />
          </linearGradient>

          <filter id="cardShadow" x="-10%" y="-10%" width="125%" height="135%" filterUnits="objectBoundingBox">
            <feDropShadow dx="0" dy="4" stdDeviation="8" floodColor="#14302b" floodOpacity="0.07" />
          </filter>

          {/* Strict container boundary clip to prevent ANY decorative lines from extending outside */}
          <clipPath id="heroCardClip">
            <rect x="6" y="6" width="528" height="358" rx="22" />
          </clipPath>
        </defs>

        {/* Ambient Rounded Container Outer Stroke & Background */}
        <rect
          x="6"
          y="6"
          width="528"
          height="358"
          rx="22"
          fill="url(#bgGrad)"
          stroke="#d7e5e0"
          strokeWidth="1.5"
        />

        {/* Group clipped to container boundary */}
        <g clipPath="url(#heroCardClip)">
          {/* Subtle Geo-Radar / Availability Rings behind illustration */}
          <circle cx="190" cy="185" r="145" stroke="#d5ede3" strokeWidth="1.2" strokeDasharray="6 6" opacity="0.6" />
          <circle cx="190" cy="185" r="100" stroke="#c9e8dc" strokeWidth="1.2" strokeDasharray="4 4" opacity="0.75" />
          <circle cx="190" cy="185" r="60" stroke="#bfe3d5" strokeWidth="1.2" opacity="0.8" />

          {/* Soft Ground Shadows */}
          <ellipse cx="215" cy="288" rx="75" ry="10" fill="#d2e8df" opacity="0.7" />
          <ellipse cx="80" cy="268" rx="32" ry="7" fill="#d2e8df" opacity="0.6" />

          {/* Modern Pharmacy Building Storefront */}
          <g id="pharmacy-building">
            {/* Building Facade */}
            <rect x="145" y="145" width="145" height="142" rx="10" fill="#ffffff" stroke="#cce3d8" strokeWidth="2" />

            {/* Canopy / Awning */}
            <path d="M 135 145 L 300 145 L 288 120 L 147 120 Z" fill="#0f6655" />
            <path d="M 166 145 L 179 145 L 176 120 L 168 120 Z" fill="#0b4e42" />
            <path d="M 202 145 L 215 145 L 212 120 L 204 120 Z" fill="#0b4e42" />
            <path d="M 238 145 L 251 145 L 248 120 L 240 120 Z" fill="#0b4e42" />
            <path d="M 274 145 L 287 145 L 283 120 L 275 120 Z" fill="#0b4e42" />

            {/* Pharmacy Cross Top Sign */}
            <rect x="199" y="96" width="38" height="38" rx="19" fill="#0f6655" stroke="#ffffff" strokeWidth="2.5" />
            <path d="M 218 105 V 125 M 208 115 H 228" stroke="#ffffff" strokeWidth="4" strokeLinecap="round" />

            {/* Window Display with Medicine Shelves */}
            <rect x="157" y="163" width="56" height="92" rx="6" fill="#f0faf6" stroke="#d5ebe1" strokeWidth="1.5" />
            {/* Shelf 1 */}
            <line x1="162" y1="189" x2="208" y2="189" stroke="#cbd5e1" strokeWidth="2" strokeLinecap="round" />
            <rect x="165" y="173" width="9" height="15" rx="2" fill="#0f6655" />
            <rect x="177" y="170" width="12" height="18" rx="2.5" fill="#ffffff" stroke="#0f6655" strokeWidth="1" />
            <rect x="192" y="174" width="8" height="14" rx="2" fill="#0d9488" />
            {/* Shelf 2 */}
            <line x1="162" y1="219" x2="208" y2="219" stroke="#cbd5e1" strokeWidth="2" strokeLinecap="round" />
            <rect x="165" y="203" width="11" height="15" rx="2" fill="#ffffff" stroke="#0d9488" strokeWidth="1" />
            <rect x="179" y="206" width="9" height="12" rx="2" fill="#0f6655" />
            <rect x="191" y="202" width="11" height="16" rx="2" fill="#dcefe9" stroke="#0f6655" strokeWidth="1" />
            {/* Shelf 3 */}
            <line x1="162" y1="247" x2="208" y2="247" stroke="#cbd5e1" strokeWidth="2" strokeLinecap="round" />
            <rect x="167" y="232" width="10" height="14" rx="2" fill="#0f6655" />
            <rect x="180" y="234" width="8" height="12" rx="2" fill="#059669" />
            <rect x="191" y="231" width="11" height="15" rx="2" fill="#ffffff" stroke="#0f6655" strokeWidth="1" />

            {/* Glass Door / Entrance */}
            <rect x="226" y="163" width="51" height="124" rx="5" fill="#f8faf9" stroke="#d5ebe1" strokeWidth="1.5" />
            <line x1="251" y1="163" x2="251" y2="287" stroke="#e2e8f0" strokeWidth="1" />
            <rect x="246" y="220" width="3" height="16" rx="1.5" fill="#0f6655" />
            <rect x="254" y="220" width="3" height="16" rx="1.5" fill="#0f6655" />
          </g>

          {/* PharmaTrack Signature Map Pin & Pill Capsule */}
          <g id="pharmatrack-pin">
            {/* Signal Wave Arcs */}
            <path d="M 106 108 C 114 114, 120 122, 124 132" stroke="#10b981" strokeWidth="2.8" strokeLinecap="round" fill="none" />
            <path d="M 115 99 C 127 107, 135 119, 139 133" stroke="#10b981" strokeWidth="2.8" strokeLinecap="round" fill="none" opacity="0.75" />

            {/* Map Pin Geometry */}
            <path
              d="M 80 252 C 55 212, 32 186, 32 156 C 32 126, 54 102, 80 102 C 106 102, 128 126, 128 156 C 128 186, 105 212, 80 252 Z"
              fill="url(#pinGrad)"
              stroke="#ffffff"
              strokeWidth="2.8"
              filter="drop-shadow(0 6px 12px rgba(11, 78, 66, 0.22))"
            />

            {/* Orbit Dynamic Ring around Pin */}
            <ellipse
              cx="80"
              cy="160"
              rx="58"
              ry="18"
              fill="none"
              stroke="#0284c7"
              strokeWidth="2.8"
              strokeDasharray="76 22"
              strokeLinecap="round"
              transform="rotate(-18 80 160)"
            />

            {/* Inner Circle Window */}
            <circle cx="80" cy="154" r="26" fill="#ffffff" />

            {/* Pill Capsule at 45 degree angle */}
            <g transform="translate(80, 154) rotate(-45)">
              <path d="M -9 -17 C -9 -22, 9 -22, 9 -17 L 9 0 L -9 0 Z" fill="url(#capsuleTeal)" />
              <path d="M -9 0 L 9 0 L 9 17 C 9 22, -9 22, -9 17 Z" fill="#dcefe9" stroke="#0f6655" strokeWidth="0.8" />
              <line x1="-9" y1="0" x2="9" y2="0" stroke="#0b4e42" strokeWidth="1.4" />
            </g>
          </g>
        </g>

        {/* 3 Consistently Aligned Status Cards (Right Column) */}
        {/* Card 1: Live Availability */}
        <g id="card-live-stock" filter="url(#cardShadow)">
          <rect x="316" y="44" width="198" height="62" rx="14" fill="#ffffff" stroke="#d5ebe1" strokeWidth="1.5" />
          {/* Live pulsing dot icon container */}
          <rect x="328" y="57" width="34" height="34" rx="9" fill="#e8f7f1" />
          <circle cx="345" cy="74" r="5" fill="#10b981" />
          <circle cx="345" cy="74" r="8.5" fill="none" stroke="#10b981" strokeWidth="1.5" opacity="0.45" />
          <text x="372" y="69" fill="#14302b" fontSize="12.5" fontWeight="800" fontFamily="Inter, sans-serif">
            Live Availability
          </text>
          <text x="372" y="85" fill="#0f6655" fontSize="10.5" fontWeight="600" fontFamily="Inter, sans-serif">
            Stock Verified in Store
          </text>
        </g>

        {/* Card 2: Nearby Pharmacies */}
        <g id="card-nearby-pill" filter="url(#cardShadow)">
          <rect x="316" y="126" width="198" height="62" rx="14" fill="#ffffff" stroke="#d5ebe1" strokeWidth="1.5" />
          {/* Location pin badge container */}
          <rect x="328" y="139" width="34" height="34" rx="9" fill="#e8f7f1" />
          <path d="M 345 148 C 341.5 148, 338.5 151, 338.5 154.5 C 338.5 159, 345 165, 345 165 C 345 165, 351.5 159, 351.5 154.5 C 351.5 151, 348.5 148, 345 148 Z" fill="#0f6655" />
          <circle cx="345" cy="154.5" r="2" fill="#ffffff" />
          <text x="372" y="151" fill="#14302b" fontSize="12.5" fontWeight="800" fontFamily="Inter, sans-serif">
            Nearby Pharmacies
          </text>
          <text x="372" y="167" fill="#0f6655" fontSize="10.5" fontWeight="600" fontFamily="Inter, sans-serif">
            Real-time Distance &amp; Map
          </text>
        </g>

        {/* Card 3: Reserve & Hold */}
        <g id="card-reserve-hold" filter="url(#cardShadow)">
          <rect x="316" y="208" width="198" height="62" rx="14" fill="#ffffff" stroke="#d5ebe1" strokeWidth="1.5" />
          {/* Reservation check badge container */}
          <rect x="328" y="221" width="34" height="34" rx="9" fill="#e8f7f1" />
          <path d="M 340 238 L 343.5 241.5 L 350.5 234.5" stroke="#0f6655" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" fill="none" />
          <text x="372" y="233" fill="#14302b" fontSize="12.5" fontWeight="800" fontFamily="Inter, sans-serif">
            Reserve &amp; Hold
          </text>
          <text x="372" y="249" fill="#0f6655" fontSize="10.5" fontWeight="600" fontFamily="Inter, sans-serif">
            Ready for 2-hour pickup
          </text>
        </g>
      </svg>
    </div>
  );
}
