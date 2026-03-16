import React from 'react';

const CursorOverlay = ({ position, isVisible, isDragging = false, variant = 'default' }) => {
  if (!isVisible || !position || !position.detected) {
    return null;
  }

  const isPinching = position.isPinching || false;
  const pinchStrength = position.pinchStrength || 0;
  const isSleepVariant = variant === 'sleep';

  const handSize = position.handSize || 18;
  const distanceScale = Math.min(Math.max(handSize / 18, 0.4), 2.2);

  const baseSize = (isSleepVariant ? 64 : 32) * distanceScale;
  const pinchSizeIncrease = isSleepVariant ? 0 : 12 * distanceScale;
  const currentSize = baseSize + (pinchSizeIncrease * pinchStrength);
  const centerOffset = currentSize / 2;

  const baseGlow = isSleepVariant ? 45 : (isPinching ? 30 : 20);
  const pinchGlow = isSleepVariant ? 90 : (isPinching ? 60 : 40);
  const glowIntensity = (baseGlow + (pinchGlow - baseGlow) * pinchStrength) * distanceScale;

  const fillOpacity = isSleepVariant ? 0.35 : (isPinching ? 0.2 + (0.6 * pinchStrength) : 0.2);
  const borderWidth = isSleepVariant ? 6 : (isPinching ? 3 + (2 * pinchStrength) : 4);
  const borderColor = isSleepVariant
    ? 'rgba(59, 130, 246, 0.95)'
    : (isPinching
      ? `rgba(59, 130, 246, ${0.8 + (0.2 * pinchStrength)})`
      : 'rgba(59, 130, 246, 0.8)');

  const scaleValue = 1 + (0.15 * pinchStrength);
  const innerDotSize = (4 + (2 * pinchStrength)) * distanceScale;

  return (
    <div
      className="cursor-overlay fixed pointer-events-none"
      style={{
        left: position.x - centerOffset,
        top: position.y - centerOffset,
        transition: isDragging ? 'none' : 'left 0.1s ease-out, top 0.1s ease-out',
        zIndex: 9999,
      }}
    >
      <div className="relative">
        <div
          className="rounded-full"
          style={{
            width: `${currentSize}px`,
            height: `${currentSize}px`,
            border: `${borderWidth}px solid ${borderColor}`,
            backgroundColor: `rgba(59, 130, 246, ${fillOpacity})`,
            boxShadow: `
              0 0 ${glowIntensity}px rgba(59, 130, 246, ${0.8 + (0.2 * pinchStrength)}),
              0 0 ${glowIntensity * 2}px rgba(59, 130, 246, ${0.4 + (0.3 * pinchStrength)})
            `,
            animation: isSleepVariant
              ? 'sleep-pulse 1.2s infinite'
              : (isPinching ? 'pinch-pulse 0.5s infinite' : 'idle-pulse 2s infinite'),
            transform: `scale(${scaleValue})`,
          }}
        />

        <div
          className="absolute top-1/2 left-1/2 transform -translate-x-1/2 -translate-y-1/2 rounded-full"
          style={{
            width: `${innerDotSize}px`,
            height: `${innerDotSize}px`,
            backgroundColor: isPinching ? 'rgba(147, 197, 253, 1)' : 'rgba(147, 197, 253, 0.8)',
            boxShadow: `0 0 ${(10 + (5 * pinchStrength)) * distanceScale}px rgba(147, 197, 253, 1)`,
          }}
        />

        {isPinching && !isSleepVariant && (
          <div
            className="absolute top-1/2 left-1/2 transform -translate-x-1/2 -translate-y-1/2 rounded-full border-2"
            style={{
              width: `${currentSize + 8 * distanceScale}px`,
              height: `${currentSize + 8 * distanceScale}px`,
              borderColor: `rgba(255, 255, 255, ${0.3 + (0.4 * pinchStrength)})`,
              animation: 'pinch-ripple 0.8s infinite',
            }}
          />
        )}
      </div>

      <style>{`
        @keyframes idle-pulse {
          0%   { transform: scale(1);    opacity: 1;   }
          50%  { transform: scale(1.05); opacity: 0.9; }
          100% { transform: scale(1);    opacity: 1;   }
        }
        @keyframes pinch-pulse {
          0%   { transform: scale(${scaleValue});        opacity: 1;   }
          50%  { transform: scale(${scaleValue + 0.05}); opacity: 0.8; }
          100% { transform: scale(${scaleValue});        opacity: 1;   }
        }
        @keyframes pinch-ripple {
          0%   { transform: translate(-50%, -50%) scale(0.8); opacity: 1; }
          100% { transform: translate(-50%, -50%) scale(1.2); opacity: 0; }
        }
        @keyframes sleep-pulse {
          0%   { transform: scale(1);    opacity: 1;    }
          40%  { transform: scale(1.05); opacity: 0.95; }
          100% { transform: scale(1);    opacity: 1;    }
        }
      `}</style>
    </div>
  );
};

export default CursorOverlay;