import { spawn, ChildProcess } from 'child_process';
import { Logger, ILogObj } from 'tslog';
import { escapePrompt } from '../utils.js';

/**
 * Claude log event types based on LOG_STRUCT.md
 */
export type LogEvent = {
  readonly type: 'system' | 'assistant' | 'user' | 'result';
  readonly subtype?: string;
  readonly session_id?: string;
  readonly model?: string;
  readonly cwd?: string;
  readonly tools?: string[];
  readonly message?: {
    readonly id: string;
    readonly role: string;
    readonly content: Array<{
      readonly type: 'text' | 'tool_use' | 'tool_result';
      readonly text?: string;
      readonly name?: string;
      readonly input?: any;
      readonly tool_use_id?: string;
      readonly content?: string;
    }>;
  };
  readonly duration_ms?: number;
  readonly is_error?: boolean;
  readonly total_cost_usd?: number;
  readonly result?: string;
  readonly [key: string]: any;
};

/**
 * Configuration options for Claude Code execution
 */
export type ClaudeConfig = {
  readonly additionalArgs?: string[];
  readonly timeoutMs?: number;
};

/**
 * Claude Code agent class for executing prompts and managing sessions
 * 
 * @example
 * ```typescript
 * const claude = new ClaudeCode();
 * const result = await claude.execute("Create a hello world function");
 * console.log(result);
 * ```
 */
export class ClaudeCode {
  private readonly config: Required<ClaudeConfig>;
  private readonly log: Logger<ILogObj>;
  private process: ChildProcess | null = null;
  private buffer = '';
  private result = '';
  private timeoutId: NodeJS.Timeout | null = null;

  /**
   * Creates a new Claude Code instance
   * 
   * @param config - Configuration options for Claude execution
   */
  constructor(config: ClaudeConfig = {}) {
    this.config = {
      additionalArgs: config.additionalArgs ?? [],
      timeoutMs: config.timeoutMs ?? 180000, // Default: 3 minutes
    };

    // Initialize structured logger with log level based on environment variable
    const logLevel = this.getLogLevel();
    this.log = new Logger({
      name: "ClaudeCode",
      minLevel: logLevel,
      type: process.env["NODE_ENV"] === 'production' ? "json" : "pretty",
      maskValuesOfKeys: ["apiKey", "token"],
      prettyLogTemplate: "{{yyyy}}.{{mm}}.{{dd}} {{hh}}:{{MM}}:{{ss}}\t{{logLevelName}}\t{{name}}\t",
    });
  }

  /**
   * Determines log level based on environment variables
   */
  private getLogLevel(): number {
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
   * Executes a prompt using Claude Code
   * 
   * @param prompt - The prompt text to send to Claude
   * @returns Promise that resolves with the result string
   */
  async execute(prompt: string): Promise<string> {
    if (!prompt || prompt.trim() === '') {
      const error = new Error('Prompt cannot be empty');
      this.log.error("Invalid prompt", { error: error.message });
      throw error;
    }

    this.log.info("Starting Claude execution", { 
      prompt: prompt,
      promptLength: prompt.length,
      additionalArgs: this.config.additionalArgs,
      timeoutMs: this.config.timeoutMs
    });

    // Reset result for new execution
    this.result = '';

    return new Promise((resolve, reject) => {
      const args = this.buildCommandArgs(prompt);
      
      this.log.debug("Spawning Claude process", { 
        args: args,
        originalPrompt: prompt
      });
      
      this.process = spawn('claude', args, {
        stdio: ['inherit', 'pipe', 'pipe'],
        shell: true
      });

      // Set up timeout
      this.timeoutId = setTimeout(() => {
        this.log.error("Claude execution timed out", {
          prompt: prompt,
          timeoutMs: this.config.timeoutMs
        });
        this.terminate();
        reject(new Error(`Claude execution timed out after ${this.config.timeoutMs}ms`));
      }, this.config.timeoutMs);

      this.setupEventHandlers(resolve, reject, prompt);
    });
  }

  /**
   * Terminates the current Claude process if running
   */
  terminate(): void {
    if (this.timeoutId) {
      clearTimeout(this.timeoutId);
      this.timeoutId = null;
    }
    
    if (this.process) {
      this.log.debug("Terminating Claude process", { pid: this.process.pid });
      this.process.kill('SIGTERM');
      this.process = null;
    }
  }

  /**
   * Builds command line arguments for Claude execution
   * Always includes --verbose, --output-format stream-json, and --print
   * Uses shared utility for prompt escaping
   * 
   * @param prompt - The prompt to execute
   * @returns Array of command line arguments
   */
  private buildCommandArgs(prompt: string): string[] {
    // Use shared escape utility
    const escapedPrompt = escapePrompt(prompt, this.log);
    
    const args = [
      escapedPrompt,
      '--dangerously-skip-permissions',
      '--print',
      '--output-format', 'stream-json',
      '--verbose'
    ];
    
    args.push(...this.config.additionalArgs);
    
    return args;
  }

  /**
   * Sets up event handlers for the spawned Claude process
   * 
   * @param resolve - Promise resolve function
   * @param reject - Promise reject function
   * @param prompt - Original prompt for logging
   */
  private setupEventHandlers(
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
      const errorMessage = data.toString();
      this.log.error("Process stderr", { message: errorMessage.trim() });
    });

    this.process.on('error', (error) => {
      this.log.error("Process error", { error: error.message });
      reject(error);
    });

    this.process.on('exit', (code) => {
      // Clear timeout on process exit
      if (this.timeoutId) {
        clearTimeout(this.timeoutId);
        this.timeoutId = null;
      }
      
      // Process any remaining data in buffer
      if (this.buffer.trim()) {
        this.parseClaudeOutput(this.buffer);
      }
      
      const exitCode = code || 0;
      
      this.log.debug("Process exited", { 
        exitCode,
        resultLength: this.result.length
      });
      
      if (exitCode === 0) {
        this.log.info("Claude execution completed successfully", {
          prompt: prompt,
          resultLength: this.result.length
        });
        resolve(this.result);
      } else {
        const error = new Error(`Claude process exited with code ${exitCode}`);
        this.log.error("Claude execution failed", { 
          prompt: prompt,
          exitCode: exitCode, 
          error: error.message 
        });
        reject(error);
      }
    });
  }

  /**
   * Handles stdout data from Claude process
   * 
   * @param data - Raw stdout data
   */
  private handleStdoutData(data: Buffer): void {
    const dataString = data.toString();
    this.buffer += dataString;
    
    this.log.debug("Received stdout data", { 
      dataLength: dataString.length,
      bufferLength: this.buffer.length,
      content: dataString
    });
    
    // Process complete lines
    const lines = this.buffer.split('\n');
    this.buffer = lines.pop() || ''; // Keep incomplete line in buffer
    
    for (const line of lines) {
      if (line.trim()) {
        this.parseClaudeOutput(line);
      }
    }
    
    // Don't output raw JSON logs to keep output clean
  }

  /**
   * Parses Claude output and handles logging
   * 
   * @param data - Raw output data from Claude
   */
  private parseClaudeOutput(data: string): void {
    try {
      const event: LogEvent = JSON.parse(data);
      
      this.log.debug("Parsed Claude event", { 
        type: event.type,
        subtype: event.subtype
      });
      
      // Always capture result regardless of debug logging
      if (event.type === 'result' && event.result) {
        this.result = event.result;
        this.log.debug("Captured result", { resultLength: this.result.length });
      }
      
      // Log Claude activity with structured logging
      this.logClaudeActivity(event);
    } catch (error) {
      this.log.debug("Failed to parse Claude output", { 
        data: data.substring(0, 100),
        error: error instanceof Error ? error.message : String(error)
      });
    }
  }

  /**
   * Logs Claude's current activity based on the event type using structured logging
   * 
   * @param event - Parsed log event from Claude
   */
  private logClaudeActivity(event: LogEvent): void {
    switch (event.type) {
      case 'system':
        if (event.subtype === 'init') {
          this.log.debug("Claude session initialized", {
            model: event.model,
            cwd: event.cwd,
            toolsCount: event.tools?.length || 0,
            sessionId: event.session_id
          });
        }
        break;
        
      case 'assistant':
        if (event.message?.content) {
          for (const content of event.message.content) {
            if (content.type === 'text' && content.text) {
              this.log.debug("Claude is processing", {
                messageId: event.message.id,
                textLength: content.text.length
              });
            } else if (content.type === 'tool_use' && content.name) {
              this.log.debug("Claude is using tool", {
                toolName: content.name,
                toolId: content.tool_use_id,
                messageId: event.message.id
              });
            }
          }
        }
        break;
        
      case 'user':
        if (event.message?.content) {
          for (const content of event.message.content) {
            if (content.type === 'tool_result') {
              this.log.debug("Tool execution completed", {
                toolUseId: content.tool_use_id,
                hasContent: !!content.content
              });
            }
          }
        }
        break;
        
      case 'result':
        if (event.duration_ms) {
          const sessionData = {
            duration: event.duration_ms,
            cost: event.total_cost_usd,
            isError: event.is_error,
            sessionId: event.session_id,
            resultLength: event.result?.length || 0
          };
          
          if (event.is_error) {
            this.log.error("Claude session ended with errors", sessionData);
          } else {
            this.log.info("Claude session completed successfully", sessionData);
          }
        }
        break;
    }
  }
}

