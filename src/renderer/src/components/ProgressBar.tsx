/* eslint-disable prettier/prettier */

export const ProgressBar = ({ value }: { value: number }) => (
  <div className="progress-bar-container">
    <div className="progress-bar-fill" style={{ width: `${value}%` }} />
  </div>
);