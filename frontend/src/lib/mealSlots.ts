import type { LucideIcon } from 'lucide-react';
import { Coffee, Moon, Sun, Sunrise } from 'lucide-react';

export type MealSlotKey = 'breakfast' | 'lunch' | 'snacks' | 'supper';

/** Slot hours come from the backend (`slot_defs`); this only adds the look. */
export interface MealSlotDef {
  key: MealSlotKey;
  label: string;
  start_hour: number;
  end_hour: number;
  range_label: string;
}

export const MEAL_SLOT_KEYS: MealSlotKey[] = ['breakfast', 'lunch', 'snacks', 'supper'];

export const MEAL_SLOT_STYLE: Record<MealSlotKey, { color: string; icon: LucideIcon }> = {
  breakfast: { color: '#f59e0b', icon: Sunrise },
  lunch: { color: '#10b981', icon: Sun },
  snacks: { color: '#ec4899', icon: Coffee },
  supper: { color: '#6366f1', icon: Moon },
};
