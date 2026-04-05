// src/renderer/src/components/Input.tsx
import React from 'react'

interface InputProps extends React.InputHTMLAttributes<HTMLInputElement> {
  label?: string
}

export const Input: React.FC<InputProps> = ({ label, ...props }) => {
  return (
    <div className="form-group">
      <label>{label}</label>
      <input {...props} />
    </div>
  )
}
