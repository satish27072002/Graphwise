import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

/**
 * Merge Tailwind CSS class names — handles conflicts correctly.
 * Required by shadcn/ui components. Both clsx and tailwind-merge
 * are already in package.json.
 */
export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}
