import styles from './AppBar.module.scss';
import { cn } from '../../../utils/cn';

// ---------------------------------------------------------------------------
// Prop interface
// ---------------------------------------------------------------------------

export interface AppBarProps {
  children: React.ReactNode;
  className?: string;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function AppBar({ children, className }: AppBarProps) {
  const classNames = cn(styles.appbar, className);

  return (
    <header className={classNames}>
      {children}
    </header>
  );
}
