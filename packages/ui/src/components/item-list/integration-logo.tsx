import React, { useState, useEffect } from 'react';
import { Blocks } from 'lucide-react';

interface IntegrationLogoProps {
  src: string;
  size?: number;
}

export function IntegrationLogo({ src, size = 20 }: IntegrationLogoProps) {
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    setFailed(false);
  }, [src]);

  if (!src || failed) {
    return (
      <Blocks
        className="text-muted-foreground"
        style={{ width: size, height: size }}
      />
    );
  }

  return (
    <span className="inline-flex shrink-0 items-center justify-center">
      <img
        src={src}
        alt=""
        width={size}
        height={size}
        className="object-contain"
        crossOrigin="anonymous"
        onError={() => setFailed(true)}
      />
    </span>
  );
}
