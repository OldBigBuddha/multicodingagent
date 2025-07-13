import { spawn, ChildProcess } from 'child_process';
import { Logger, ILogObj } from 'tslog';

/**
 * Base configuration options for CLI-based AI agents
 */
export type CLIAgentConfig = {
  readonly additionalArgs?: string[];
  readonly timeoutMs?: number;
};

/**
 * Abstract base class for CLI-based AI agents
 * 
 * Provides common functionality for spawning and managing CLI processes,
 * including timeout handling, logging, and process lifecycle management.
 * 
 * @abstract
 */
export abstract class CLIAgent {
  protected readonly config: Required<CLIAgentConfig>;
  protected readonly log: Logger<ILogObj>;
  protected process: ChildProcess | null = null;
  protected timeoutId: NodeJS.Timeout | null = null;

  /**
   * Creates a new CLI agent instance
   * 
   * @param agentName - Name for the logger (e.g., "ClaudeCode", "GeminiCode")
   * @param config - Configuration options for the agent
   */
  constructor(agentName: string, config: CLIAgentConfig = {}) {
    this.config = {
      additionalArgs: config.additionalArgs ?? [],
      timeoutMs: config.timeoutMs ?? 180000, // Default: 3 minutes
    };

    // Initialize structured logger with log level based on environment variable
    const logLevel = this.getLogLevel();
    this.log = new Logger({
      name: agentName,
      minLevel: logLevel,
      type: process.env["NODE_ENV"] === 'production' ? "json" : "pretty",
      maskValuesOfKeys: ["apiKey", "token", "api_key"],
      prettyLogTemplate: "{{yyyy}}.{{mm}}.{{dd}} {{hh}}:{{MM}}:{{ss}}\\t{{logLevelName}}\\t{{name}}\\t",
    });
  }

  /**
   * Executes a prompt using the CLI agent
   * 
   * @param prompt - The prompt text to send to the agent
   * @returns Promise that resolves with the result string
   */
  async execute(prompt: string): Promise<string> {
    if (!prompt || prompt.trim() === '') {
      const error = new Error('Prompt cannot be empty');
      this.log.error("Invalid prompt", { error: error.message });
      throw error;
    }

    this.log.info(`Starting ${this.getAgentName()} execution`, { 
      prompt: prompt,
      promptLength: prompt.length,
      timeoutMs: this.config.timeoutMs
    });

    return new Promise((resolve, reject) => {
      const args = this.buildCommandArgs(prompt);
      
      this.log.debug(`Spawning ${this.getAgentName()} process`, { 
        args: args,
        originalPrompt: prompt
      });
      
      this.process = spawn(this.getCommandName(), args, this.getSpawnOptions());

      // Set up timeout
      this.timeoutId = setTimeout(() => {
        this.log.error(`${this.getAgentName()} execution timed out`, {
          prompt: prompt,
          timeoutMs: this.config.timeoutMs
        });
        this.terminate();
        reject(new Error(`${this.getAgentName()} execution timed out after ${this.config.timeoutMs}ms`));
      }, this.config.timeoutMs);

      this.setupEventHandlers(resolve, reject, prompt);
    });
  }

  /**
   * Terminates the current process if running
   */
  terminate(): void {
    if (this.timeoutId) {
      clearTimeout(this.timeoutId);
      this.timeoutId = null;
    }
    
    if (this.process) {
      this.log.debug(`Terminating ${this.getAgentName()} process`, { pid: this.process.pid });
      this.process.kill('SIGTERM');
      this.process = null;
    }
  }

  /**
   * Determines log level based on environment variables
   */
  protected getLogLevel(): number {
    const logLevel = process.env["LOG_LEVEL"] || process.env["LOGLEVEL"] || "info";
    
    switch (logLevel.toLowerCase()) {
      case 'trace': return 0;
      case 'debug': return 1;
      case 'info': return 3;
      case 'warn': return 4;
      case 'error': return 5;
      case 'fatal': return 6;
      default: return 3; // info
    }
  }

  /**
   * Escapes a prompt string to safely pass it as a command line argument
   * Uses Base64 encoding for complex prompts with multiline content
   * 
   * @param prompt - The raw prompt string
   * @returns Properly escaped prompt string
   */
  protected escapePrompt(prompt: string): string {
    // For complex prompts with newlines or special characters, use Base64 encoding approach
    if (prompt.includes('\n') || prompt.includes('"') || prompt.includes("'") || prompt.length > 200) {
      this.log.debug("Using Base64 encoding for complex prompt", {
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
    
    this.log.debug("Using standard escaping for simple prompt", {
      originalLength: prompt.length,
      escapedLength: escaped.length
    });
    
    return escaped;
  }

  /**
   * Builds command line arguments for execution
   * Uses built-in prompt escaping
   * 
   * @param prompt - The prompt to execute
   * @returns Array of command line arguments
   */
  protected buildCommandArgs(prompt: string): string[] {
    // Use built-in escape method
    const escapedPrompt = this.escapePrompt(prompt);
    
    const args = [escapedPrompt];
    
    // Add agent-specific arguments
    args.push(...this.getAgentSpecificArgs());
    
    // Add any additional arguments
    args.push(...this.config.additionalArgs);
    
    return args;
  }

  /**
   * Sets up event handlers for the spawned process with shared timeout cleanup
   * 
   * @param resolve - Promise resolve function
   * @param reject - Promise reject function
   * @param prompt - Original prompt for logging
   */
  protected setupEventHandlers(
    resolve: (result: string) => void,
    reject: (error: Error) => void,
    prompt: string
  ): void {
    if (!this.process) {
      reject(new Error('Process not initialized'));
      return;
    }

    this.process.stdout?.on('data', (data) => {
      this.handleStdoutData(data);
    });

    this.process.stderr?.on('data', (data) => {
      this.handleStderrData(data);
    });

    this.process.on('error', (error) => {
      this.log.error("Process error", { 
        prompt: prompt,
        error: error.message 
      });
      reject(error);
    });

    this.process.on('exit', (code) => {
      // Clear timeout on process exit
      if (this.timeoutId) {
        clearTimeout(this.timeoutId);
        this.timeoutId = null;
      }
      
      this.handleProcessExit(code, resolve, reject, prompt);
    });
  }

  // Abstract methods that subclasses must implement

  /**
   * Returns the command name to execute (e.g., 'claude', 'gemini')
   */
  protected abstract getCommandName(): string;

  /**
   * Returns the agent name for logging (e.g., 'Claude Code', 'Gemini')
   */
  protected abstract getAgentName(): string;

  /**
   * Returns agent-specific command line arguments
   */
  protected abstract getAgentSpecificArgs(): string[];

  /**
   * Returns spawn options for the child process
   */
  protected abstract getSpawnOptions(): any;

  /**
   * Handles stdout data from the process
   * 
   * @param data - Raw stdout data
   */
  protected abstract handleStdoutData(data: Buffer): void;

  /**
   * Handles stderr data from the process
   * 
   * @param data - Raw stderr data
   */
  protected abstract handleStderrData(data: Buffer): void;

  /**
   * Handles process exit
   * 
   * @param code - Exit code
   * @param resolve - Promise resolve function
   * @param reject - Promise reject function
   * @param prompt - Original prompt for logging
   */
  protected abstract handleProcessExit(
    code: number | null,
    resolve: (result: string) => void,
    reject: (error: Error) => void,
    prompt: string
  ): void;
}