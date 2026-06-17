/**
 * Generates a high-contrast geometric SVG avatar based on a seed name.
 * Returns a Base64-encoded SVG URL that can be directly passed to <img> src tags.
 */
export function generateAvatar(name: string): string {
  const hashString = (str: string): number => {
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
      hash = str.charCodeAt(i) + ((hash << 5) - hash);
    }
    return Math.abs(hash);
  };

  const seed = hashString(name);
  
  // Neon-inspired cyberpunk color palette
  const colors = [
    "#a855f7", // Purple
    "#ec4899", // Pink
    "#3b82f6", // Blue
    "#06b6d4", // Cyan
    "#10b981", // Emerald
    "#f59e0b", // Amber
    "#ef4444", // Red
  ];

  const bgColor1 = colors[seed % colors.length];
  const bgColor2 = colors[(seed + 2) % colors.length];
  const accentColor = colors[(seed + 4) % colors.length];

  // Pick a geometric design pattern (0 to 3)
  const pattern = seed % 4;
  let patternSvg = "";

  if (pattern === 0) {
    // Interlocking rings
    patternSvg = `
      <circle cx="50" cy="50" r="30" fill="none" stroke="${accentColor}" stroke-dasharray="10 5" stroke-width="6" />
      <circle cx="50" cy="50" r="18" fill="${accentColor}" fill-opacity="0.6" />
    `;
  } else if (pattern === 1) {
    // Isometric diamond mesh
    patternSvg = `
      <polygon points="50,15 85,50 50,85 15,50" fill="${accentColor}" fill-opacity="0.4" stroke="${accentColor}" stroke-width="4" />
      <polygon points="50,30 70,50 50,70 30,50" fill="${bgColor2}" fill-opacity="0.8" />
    `;
  } else if (pattern === 2) {
    // Concentric rotating circles
    patternSvg = `
      <circle cx="50" cy="50" r="28" fill="none" stroke="${accentColor}" stroke-width="5" />
      <polygon points="50,25 65,60 35,60" fill="${accentColor}" />
      <polygon points="50,75 60,50 40,50" fill="${bgColor1}" />
    `;
  } else {
    // Digital grid pattern
    patternSvg = `
      <rect x="25" y="25" width="22" height="22" fill="${accentColor}" stroke="${bgColor1}" stroke-width="2" />
      <rect x="53" y="25" width="22" height="22" fill="${bgColor2}" stroke="${accentColor}" stroke-width="2" />
      <rect x="25" y="53" width="22" height="22" fill="${bgColor2}" stroke="${accentColor}" stroke-width="2" />
      <rect x="53" y="53" width="22" height="22" fill="${accentColor}" stroke="${bgColor1}" stroke-width="2" />
    `;
  }

  // Generate complete SVG code
  const svg = `
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100" width="100" height="100">
      <defs>
        <linearGradient id="grad-${seed}" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stop-color="${bgColor1}" />
          <stop offset="100%" stop-color="${bgColor2}" stop-opacity="0.4" />
        </linearGradient>
      </defs>
      <rect width="100" height="100" fill="url(#grad-${seed})" />
      ${patternSvg}
      <text x="50" y="55" font-family="system-ui, -apple-system, sans-serif" font-size="28" font-weight="bold" fill="#ffffff" text-anchor="middle" dominant-baseline="middle">
        ${name.charAt(0).toUpperCase()}
      </text>
    </svg>
  `;

  // Encode to Base64 data URI
  const base64Svg = btoa(unescape(encodeURIComponent(svg)));
  return `data:image/svg+xml;base64,${base64Svg}`;
}
