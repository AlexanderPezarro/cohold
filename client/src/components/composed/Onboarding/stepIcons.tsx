import React from 'react';
import type { LucideIcon } from 'lucide-react';
import {
  Calendar,
  CircleDot,
  FileText,
  Folder,
  Home,
  Landmark,
  PoundSterling,
  UserPlus,
  Users,
  Wand2,
} from 'lucide-react';

/**
 * Maps a registry `icon` key to a lucide icon.
 *
 * Unknown keys fall back to a generic marker, so adding a step with a new icon
 * name renders sensibly even before anyone wires the icon up here.
 */
const ICONS: Record<string, LucideIcon> = {
  users: Users,
  'user-plus': UserPlus,
  home: Home,
  'file-text': FileText,
  landmark: Landmark,
  wand: Wand2,
  pound: PoundSterling,
  calendar: Calendar,
  folder: Folder,
};

export const StepIcon: React.FC<{ icon: string; size?: number }> = ({ icon, size = 20 }) => {
  const Icon = ICONS[icon] ?? CircleDot;
  return <Icon size={size} />;
};
