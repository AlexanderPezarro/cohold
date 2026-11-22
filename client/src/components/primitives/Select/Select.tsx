import { useId } from 'react';
import { ChevronDown } from 'lucide-react';
import { cn } from '../../../utils/cn';
import styles from './Select.module.scss';

export interface SelectOption {
  value: string;
  label: string;
}

export interface SelectProps {
  label?: string;
  placeholder?: string;
  options: SelectOption[];
  value?: string;
  onChange?: (value: string) => void;
  error?: boolean;
  helperText?: string;
  disabled?: boolean;
  fullWidth?: boolean;
  size?: 'small' | 'medium';
  name?: string;
}

export function Select({
  label,
  placeholder,
  options,
  value = '',
  onChange,
  error = false,
  helperText,
  disabled = false,
  fullWidth = false,
  size = 'medium',
  name,
}: SelectProps) {
  const generatedId = useId();
  const helperId = `${generatedId}-helper`;

  const wrapperClassNames = cn(styles.wrapper, fullWidth && styles.fullWidth);

  const selectClassNames = cn(
    styles.select,
    styles[size],
    error && styles.error,
    disabled && styles.disabled,
    !value && placeholder && styles.placeholder
  );

  const handleChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    onChange?.(e.target.value);
  };

  return (
    <div className={wrapperClassNames}>
      <div className={styles.selectContainer}>
        <select
          id={generatedId}
          className={selectClassNames}
          value={value}
          onChange={handleChange}
          disabled={disabled}
          name={name}
          aria-invalid={error || undefined}
          aria-describedby={helperText ? helperId : undefined}
        >
          {placeholder && (
            <option value="" disabled>
              {placeholder}
            </option>
          )}
          {options.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
        <span className={cn(styles.arrow, disabled && styles.arrowDisabled)} aria-hidden="true">
          <ChevronDown size={10} strokeWidth={1.5} />
        </span>
        {/* Sits on the top border like a TextField's floated label, so the two line up side by side. */}
        {label && (
          <label htmlFor={generatedId} className={cn(styles.label, error && styles.labelError)}>
            {label}
          </label>
        )}
      </div>
      {helperText && (
        <span id={helperId} className={cn(styles.helperText, error && styles.helperTextError)}>
          {helperText}
        </span>
      )}
    </div>
  );
}
