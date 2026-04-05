// src/renderer/src/components/Card.tsx
import React from 'react';

interface CardProps {
  children: React.ReactNode;
  className?: string;
  style?: React.CSSProperties; 
}

export const Card: React.FC<CardProps> = ({ children, className, style }) => {
  return (
    <div className={`card-container ${className || ''}`} style={style}>
      {children}
    </div>
  );
};