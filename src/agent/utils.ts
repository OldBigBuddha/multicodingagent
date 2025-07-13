import { Logger, ILogObj } from 'tslog';

/**
 * Utility functions for agent implementations
 */

/**
 * Escapes a prompt string to safely pass it as a command line argument
 * Uses Base64 encoding for complex prompts with multiline content
 * 
 * @param prompt - The raw prompt string
 * @param logger - Optional logger for debug output
 * @returns Properly escaped prompt string
 */
export function escapePrompt(prompt: string, logger?: Logger<ILogObj>): string {
  // For complex prompts with newlines or special characters, use Base64 encoding approach
  if (prompt.includes('\n') || prompt.includes('"') || prompt.includes("'") || prompt.length > 200) {
    logger?.debug("Using Base64 encoding for complex prompt", {
      hasNewlines: prompt.includes('\n'),
      hasQuotes: prompt.includes('"') || prompt.includes("'"),
      length: prompt.length
    });
    
    // Create a temporary approach - encode and decode within the command
    const encoded = Buffer.from(prompt, 'utf-8').toString('base64');
    return `"$(echo '${encoded}' | base64 -d)"`;
  }
  
  // For simple prompts, use standard escaping
  const escaped = `"${prompt
    .replace(/\\/g, '\\\\')    // Escape backslashes
    .replace(/"/g, '\\"')      // Escape double quotes
    .replace(/\$/g, '\\$')     // Escape dollar signs
    .replace(/`/g, '\\`')}"`;  // Escape backticks
  
  logger?.debug("Using standard escaping for simple prompt", {
    originalLength: prompt.length,
    escapedLength: escaped.length
  });
  
  return escaped;
}

/**
 * Configuration options for command line argument building
 */
export interface CommandArgsConfig {
  readonly additionalArgs?: string[];
  readonly outputFormat?: string;
  readonly verbose?: boolean;
  readonly debug?: boolean;
}

/**
 * Builds command line arguments with proper prompt escaping
 * 
 * @param prompt - The prompt to execute
 * @param config - Command configuration options
 * @param logger - Optional logger for debug output
 * @returns Array of command line arguments
 */
export function buildCommandArgs(
  prompt: string, 
  config: CommandArgsConfig = {}, 
  logger?: Logger<ILogObj>
): string[] {
  const escapedPrompt = escapePrompt(prompt, logger);
  
  const args: string[] = [escapedPrompt];
  
  // Add common flags
  if (config.outputFormat) {
    args.push('--output-format', config.outputFormat);
  }
  
  if (config.verbose) {
    args.push('--verbose');
  }
  
  if (config.debug) {
    args.push('--debug');
  }
  
  // Add any additional arguments
  if (config.additionalArgs) {
    args.push(...config.additionalArgs);
  }
  
  logger?.debug("Built command arguments", {
    argsCount: args.length,
    hasEscapedPrompt: args[0] !== prompt
  });
  
  return args;
}

/**
 * Validates if a prompt is safe for command line execution
 * 
 * @param prompt - The prompt to validate
 * @returns True if the prompt appears safe
 */
export function isPromptSafe(prompt: string): boolean {
  // Check for potentially dangerous patterns
  const dangerousPatterns = [
    /;\s*rm\s+/,           // rm commands
    /;\s*sudo\s+/,         // sudo commands  
    /;\s*curl\s+.*\|\s*sh/, // curl pipe to shell
    /;\s*wget\s+.*\|\s*sh/, // wget pipe to shell
    /\$\(.*\)/,            // Command substitution (when not our Base64 pattern)
    /`.*`/,                // Backtick command substitution
  ];
  
  return !dangerousPatterns.some(pattern => pattern.test(prompt));
}

/**
 * Sanitizes a prompt by removing potentially dangerous content
 * 
 * @param prompt - The prompt to sanitize
 * @returns Sanitized prompt
 */
export function sanitizePrompt(prompt: string): string {
  return prompt
    .replace(/;\s*rm\s+.*$/gm, '')           // Remove rm commands
    .replace(/;\s*sudo\s+.*$/gm, '')         // Remove sudo commands
    .replace(/;\s*curl\s+.*\|\s*sh.*$/gm, '') // Remove curl pipes
    .replace(/;\s*wget\s+.*\|\s*sh.*$/gm, '') // Remove wget pipes
    .trim();
}