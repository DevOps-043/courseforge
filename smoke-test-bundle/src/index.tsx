import React from 'react';

export interface SmokeTestProps {
  label?: string;
}

export function MyComposition({ label = 'CUSTOM_BUNDLE_RENDERED' }: SmokeTestProps) {
  console.log('CUSTOM_BUNDLE_RENDERED');

  return (
    <div
      style={{
        alignItems: 'center',
        backgroundColor: '#d71920',
        color: 'white',
        display: 'flex',
        fontFamily: 'Arial, Helvetica, sans-serif',
        fontSize: 82,
        fontWeight: 800,
        height: 1080,
        justifyContent: 'center',
        letterSpacing: 0,
        textAlign: 'center',
        padding: '0 96px',
        width: 1920,
      }}
    >
      {label}
    </div>
  );
}
