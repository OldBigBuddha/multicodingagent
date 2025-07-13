import { spawn, ChildProcess } from 'child_process';
import { Logger, ILogObj } from 'tslog';
import { escapePrompt } from '../utils.js';

/**
 * Configuration options for Gemini Code execution
 */
export type GeminiConfig = {
  readonly additionalArgs?: string[];
  readonly timeoutMs?: number;
};

/**
 * Gemini Code agent class for executing prompts using Google's Gemini models
 * 
 * @example
 * ```typescript
 * const gemini = new GeminiCode();
 * const result = await gemini.execute("Create a hello world function");
 * console.log(result);
 * ```
 */
export class Gemini {
  private readonly config: Required<GeminiConfig>;
  private readonly log: Logger<ILogObj>;
  private process: ChildProcess | null = null;
  private timeoutId: NodeJS.Timeout | null = null;

  /**
   * Creates a new Gemini Code instance
   * 
   * @param config - Configuration options for Gemini execution
   */
  constructor(config: GeminiConfig = {}) {
    this.config = {
      additionalArgs: config.additionalArgs ?? [],
      timeoutMs: config.timeoutMs ?? 180000, // Default: 3 minutes
    };

    // Initialize structured logger with log level based on environment variable
    const logLevel = this.getLogLevel();
    this.log = new Logger({
      name: "GeminiCode",
      minLevel: logLevel,
      type: process.env["NODE_ENV"] === 'production' ? "json" : "pretty",
      maskValuesOfKeys: ["apiKey", "token", "api_key"],
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
   * Executes a prompt using Gemini CLI as a subprocess
   * 
   * @param prompt - The prompt text to send to Gemini
   * @returns Promise that resolves with the result string
   */
  async execute(prompt: string): Promise<string> {
    if (!prompt || prompt.trim() === '') {
      const error = new Error('Prompt cannot be empty');
      this.log.error("Invalid prompt", { error: error.message });
      throw error;
    }

    this.log.info("Starting Gemini execution", { 
      prompt: prompt,
      promptLength: prompt.length,
      timeoutMs: this.config.timeoutMs
    });

    return new Promise((resolve, reject) => {
      const args = this.buildCommandArgs(prompt);
      
      this.log.debug("Spawning Gemini process", { 
        args: args,
        originalPrompt: prompt
      });
      
      this.process = spawn('gemini', args, {
        stdio: ['inherit', 'pipe', 'pipe'],
        shell: false
      });

      // Set up timeout
      this.timeoutId = setTimeout(() => {
        this.log.error("Gemini execution timed out", {
          prompt: prompt,
          timeoutMs: this.config.timeoutMs
        });
        this.terminate();
        reject(new Error(`Gemini execution timed out after ${this.config.timeoutMs}ms`));
      }, this.config.timeoutMs);

      this.setupEventHandlers(resolve, reject, prompt);
    });
  }

  /**
   * Terminates the current Gemini process if running
   */
  terminate(): void {
    if (this.timeoutId) {
      clearTimeout(this.timeoutId);
      this.timeoutId = null;
    }
    
    if (this.process) {
      this.log.debug("Terminating Gemini process", { pid: this.process.pid });
      this.process.kill('SIGTERM');
      this.process = null;
    }
  }

  /**
   * Builds command line arguments for Gemini execution
   * Uses -p for non-interactive mode with shared prompt escaping
   * 
   * @param prompt - The prompt to execute
   * @returns Array of command line arguments
   */
  private buildCommandArgs(prompt: string): string[] {
    // Use shared escape utility
    const escapedPrompt = escapePrompt(prompt, this.log);
    
    const args = [
      '-p', escapedPrompt,
      '--yolo' // Enable YOLO mode to avoid interactive confirmations
    ];
    
    // Add debug flag if in development
    if (process.env["NODE_ENV"] !== 'production') {
      args.push('--debug');
    }
    
    args.push(...this.config.additionalArgs);
    
    return args;
  }

  /**
   * Sets up event handlers for the spawned Gemini process
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

    let outputBuffer = '';
    let errorBuffer = '';

    this.process.stdout?.on('data', (data) => {
      const output = data.toString();
      outputBuffer += output;
      this.log.debug("Received stdout data", { 
        dataLength: output.length,
        content: output
      });
    });

    this.process.stderr?.on('data', (data) => {
      const errorMessage = data.toString();
      errorBuffer += errorMessage;
      
      // Parse debug messages for activity tracking
      this.parseGeminiActivity(errorMessage);
      
      this.log.debug("Received stderr data", { 
        dataLength: errorMessage.length,
        content: errorMessage
      });
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
      
      const exitCode = code || 0;
      
      this.log.debug("Process exited", { 
        exitCode,
        outputLength: outputBuffer.length,
        errorLength: errorBuffer.length
      });
      
      if (exitCode === 0) {
        // Clean up the output (remove debug messages and extra whitespace)
        const cleanedOutput = this.cleanOutput(outputBuffer);
        
        this.log.info("Gemini execution completed successfully", {
          prompt: prompt,
          resultLength: cleanedOutput.length
        });
        resolve(cleanedOutput);
      } else {
        const error = new Error(`Gemini process exited with code ${exitCode}. Error: ${errorBuffer.trim()}`);
        this.log.error("Gemini execution failed", { 
          prompt: prompt,
          exitCode, 
          error: error.message,
          stderr: errorBuffer.trim()
        });
        reject(error);
      }
    });
  }

  /**
   * Parses Gemini CLI activity from debug messages for real-time tracking
   * 
   * @param data - Raw stderr data from Gemini CLI
   */
  private parseGeminiActivity(data: string): void {
    const lines = data.split('\n');
    
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed || !trimmed.startsWith('[DEBUG]')) continue;
      
      try {
        // Parse different types of debug messages
        if (trimmed.includes('MemoryDiscovery')) {
          this.handleMemoryActivity(trimmed);
        } else if (trimmed.includes('BfsFileSearch')) {
          this.handleFileSearchActivity(trimmed);
        } else if (trimmed.includes('CLI:')) {
          this.handleCliActivity(trimmed);
        } else if (trimmed.includes('Tool')) {
          this.handleToolActivity(trimmed);
        }
      } catch (error) {
        // Ignore parsing errors to avoid breaking the main flow
        this.log.debug("Failed to parse activity", { 
          line: trimmed.substring(0, 100),
          error: error instanceof Error ? error.message : String(error)
        });
      }
    }
  }

  /**
   * Handles memory-related activity logging
   */
  private handleMemoryActivity(line: string): void {
    if (line.includes('Loading server hierarchical memory')) {
      this.log.info("Gemini is loading memory context");
    } else if (line.includes('Searching for GEMINI.md')) {
      this.log.info("Gemini is searching for context files");
    } else if (line.includes('No GEMINI.md files found')) {
      this.log.info("Gemini memory search completed");
    }
  }

  /**
   * Handles file search activity logging
   */
  private handleFileSearchActivity(line: string): void {
    const scanMatch = line.match(/Scanning \[(\d+)\/(\d+)\]/);
    if (scanMatch && scanMatch[1] && scanMatch[2]) {
      const [, current, total] = scanMatch;
      if (parseInt(current) % 20 === 0 || current === total) {
        this.log.info("Gemini is scanning project files", { 
          progress: `${current}/${total}`,
          percentage: Math.round((parseInt(current) / parseInt(total)) * 100)
        });
      }
    }
  }

  /**
   * Handles CLI initialization activity logging
   */
  private handleCliActivity(line: string): void {
    if (line.includes('Delegating hierarchical memory load')) {
      this.log.info("Gemini is initializing context loading");
    }
  }

  /**
   * Handles tool-related activity logging
   */
  private handleToolActivity(line: string): void {
    if (line.includes('Tool execution')) {
      this.log.debug("Gemini is executing a tool");
    } else if (line.includes('Tool result')) {
      this.log.debug("Gemini tool execution completed");
    }
  }

  /**
   * Cleans the output from Gemini CLI by removing debug messages and extra whitespace
   * 
   * @param rawOutput - Raw output from Gemini CLI
   * @returns Cleaned output string
   */
  private cleanOutput(rawOutput: string): string {
    return rawOutput
      .split('\n')
      .filter(line => {
        // Filter out debug messages and system notifications
        const trimmed = line.trim();
        return trimmed && 
               !trimmed.startsWith('[DEBUG]') && 
               !trimmed.startsWith('Loaded cached credentials') &&
               !trimmed.startsWith('Flushing log events');
      })
      .join('\n')
      .trim();
  }
}