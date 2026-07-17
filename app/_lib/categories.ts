/** Fixed expense category set (SPEC.md v0.1 — never add ad-hoc categories). */
export const EXPENSE_CATEGORIES = [
  { value: 'food_drink', label: 'Food & Drink' },
  { value: 'housing', label: 'Housing' },
  { value: 'transport', label: 'Transport' },
  { value: 'entertainment', label: 'Entertainment' },
  { value: 'health', label: 'Health' },
  { value: 'shopping', label: 'Shopping' },
  { value: 'travel', label: 'Travel' },
  { value: 'other', label: 'Other' },
] as const;

export type ExpenseCategory = (typeof EXPENSE_CATEGORIES)[number]['value'];

const CATEGORY_VALUES = new Set<string>(EXPENSE_CATEGORIES.map((c) => c.value));

export function isExpenseCategory(value: string): value is ExpenseCategory {
  return CATEGORY_VALUES.has(value);
}

export function categoryLabel(value: string): string {
  return EXPENSE_CATEGORIES.find((c) => c.value === value)?.label ?? value;
}
