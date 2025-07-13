import { CLIAgent, type CLIAgentConfig } from '../agent.js';

/**
 * Configuration options for Gemini Code execution
 */
export type GeminiConfig = CLIAgentConfig;

/**
 * Gemini Code agent class for executing prompts using Google's Gemini models
 *
 * @example
 * ```typescript
 * const gemini = new Gemini();
 * const result = await gemini.execute("Create a hello world function");
 * console.log(result);
 * ```
 */
export class Gemini extends CLIAgent {
  /**
   * Creates a new Gemini Code instance
   *
   * @param config - Configuration options for Gemini execution
   */
  constructor(config: GeminiConfig = {}) {
    super('GeminiCode', config);
  }

  /**
   * Returns the command name to execute
   */
  protected getCommandName(): string {
    return 'gemini';
  }

  /**
   * Returns the agent name for logging
   */
  protected getAgentName(): string {
    return 'Gemini';
  }

  /**
   * Returns agent-specific command line arguments
   */
  protected getAgentSpecificArgs(): string[] {
    const args = [
      '-p', // Placeholder for prompt - will be replaced by escaped prompt
      '--yolo', // Enable YOLO mode to avoid interactive confirmations
    ];

    // Add debug flag if in development
    if (process.env.NODE_ENV !== 'production') {
      args.push('--debug');
    }

    return args;
  }

  /**
   * Returns spawn options for the child process
   */
  protected getSpawnOptions(): any {
    return {
      stdio: ['inherit', 'pipe', 'pipe'],
      shell: false,
    };
  }

  /**
   * Builds command line arguments for Gemini execution
   * Override to handle -p flag specially
   *
   * @param prompt - The prompt to execute
   * @returns Array of command line arguments
   */
  protected override buildCommandArgs(prompt: string): string[] {
    // Get the base args but replace the placeholder
    const baseArgs = this.getAgentSpecificArgs();
    const args: string[] = [];

    for (let i = 0; i < baseArgs.length; i++) {
      const arg = baseArgs[i];
      if (arg === '-p') {
        // Replace with actual escaped prompt
        args.push('-p');
        const escapedPrompt = this.escapePrompt(prompt);
        args.push(escapedPrompt);
      } else if (arg) {
        args.push(arg);
      }
    }

    // Add any additional arguments
    args.push(...this.config.additionalArgs);

    return args;
  }

  /**
   * Handles stdout data from Gemini process
   *
   * @param data - Raw stdout data
   */
  protected handleStdoutData(data: Buffer): void {
    const output = data.toString();
    this.outputBuffer += output;
    this.log.debug('Received stdout data', {
      dataLength: output.length,
      content: output,
    });
  }

  /**
   * Handles stderr data from Gemini process
   *
   * @param data - Raw stderr data
   */
  protected handleStderrData(data: Buffer): void {
    const errorMessage = data.toString();
    this.errorBuffer += errorMessage;

    // Parse debug messages for activity tracking
    this.parseGeminiActivity(errorMessage);

    this.log.debug('Received stderr data', {
      dataLength: errorMessage.length,
      content: errorMessage,
    });
  }

  /**
   * Handles process exit
   *
   * @param code - Exit code
   * @param resolve - Promise resolve function
   * @param reject - Promise reject function
   * @param prompt - Original prompt for logging
   */
  protected handleProcessExit(
    code: number | null,
    resolve: (result: string) => void,
    reject: (error: Error) => void,
    prompt: string
  ): void {
    const exitCode = code || 0;

    this.log.debug('Process exited', {
      exitCode,
      outputLength: this.outputBuffer.length,
      errorLength: this.errorBuffer.length,
    });

    if (exitCode === 0) {
      // Clean up the output (remove debug messages and extra whitespace)
      const cleanedOutput = this.cleanOutput(this.outputBuffer);

      this.log.info('Gemini execution completed successfully', {
        prompt: prompt,
        resultLength: cleanedOutput.length,
      });
      resolve(cleanedOutput);
    } else {
      const error = new Error(
        `Gemini process exited with code ${exitCode}. Error: ${this.errorBuffer.trim()}`
      );
      this.log.error('Gemini execution failed', {
        prompt: prompt,
        exitCode,
        error: error.message,
        stderr: this.errorBuffer.trim(),
      });
      reject(error);
    }
  }

  // Private properties for output buffering
  private outputBuffer = '';
  private errorBuffer = '';

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
        this.log.debug('Failed to parse activity', {
          line: trimmed.substring(0, 100),
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }
  }

  /**
   * Handles memory-related activity logging
   */
  private handleMemoryActivity(line: string): void {
    if (line.includes('Loading server hierarchical memory')) {
      this.log.info('Gemini is loading memory context');
    } else if (line.includes('Searching for GEMINI.md')) {
      this.log.info('Gemini is searching for context files');
    } else if (line.includes('No GEMINI.md files found')) {
      this.log.info('Gemini memory search completed');
    }
  }

  /**
   * Handles file search activity logging
   */
  private handleFileSearchActivity(line: string): void {
    const scanMatch = line.match(/Scanning \[(\d+)\/(\d+)\]/);
    if (scanMatch?.[1] && scanMatch[2]) {
      const [, current, total] = scanMatch;
      if (parseInt(current) % 20 === 0 || current === total) {
        this.log.info('Gemini is scanning project files', {
          progress: `${current}/${total}`,
          percentage: Math.round((parseInt(current) / parseInt(total)) * 100),
        });
      }
    }
  }

  /**
   * Handles CLI initialization activity logging
   */
  private handleCliActivity(line: string): void {
    if (line.includes('Delegating hierarchical memory load')) {
      this.log.info('Gemini is initializing context loading');
    }
  }

  /**
   * Handles tool-related activity logging
   */
  private handleToolActivity(line: string): void {
    if (line.includes('Tool execution')) {
      this.log.debug('Gemini is executing a tool');
    } else if (line.includes('Tool result')) {
      this.log.debug('Gemini tool execution completed');
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
      .filter((line) => {
        // Filter out debug messages and system notifications
        const trimmed = line.trim();
        return (
          trimmed &&
          !trimmed.startsWith('[DEBUG]') &&
          !trimmed.startsWith('Loaded cached credentials') &&
          !trimmed.startsWith('Flushing log events')
        );
      })
      .join('\n')
      .trim();
  }
}
