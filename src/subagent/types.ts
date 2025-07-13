/**
 * Task kind definitions for role-based task execution
 */
export const TASK_KIND = ['web_research', 'implementation', 'testing', 'documentation', 'analysis'] as const;

/**
 * Task kind type definitions for role-based task execution
 */
export type TaskKind = typeof TASK_KIND[number];

/**
 * Task ID type for type-safe task identification
 */
export type TaskID = string & { readonly __brand: unique symbol };