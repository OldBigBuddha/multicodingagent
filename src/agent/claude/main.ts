import { CLIAgent, type CLIAgentConfig } from '../agent.js';

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
export type ClaudeConfig = CLIAgentConfig;

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
export class ClaudeCode extends CLIAgent {
  private buffer = '';
  private result = '';

  /**
   * Creates a new Claude Code instance
   *
   * @param config - Configuration options for Claude execution
   */
  constructor(config: ClaudeConfig = {}) {
    super('ClaudeCode', config);
  }

  /**
   * Returns the command name to execute
   */
  protected getCommandName(): string {
    return 'claude';
  }

  /**
   * Returns the agent name for logging
   */
  protected getAgentName(): string {
    return 'Claude Code';
  }

  /**
   * Builds command line arguments for Claude Code execution
   *
   * @param prompt - The prompt to execute
   * @returns Array of command line arguments
   */
  protected buildCommandArgs(prompt: string): string[] {
    const escapedPrompt = this.escapePrompt(prompt);

    const args = [
      escapedPrompt,
      '--dangerously-skip-permissions',
      '--print',
      '--output-format',
      'stream-json',
      '--verbose',
    ];

    // Add any additional arguments
    args.push(...this.config.additionalArgs);

    return args;
  }

  /**
   * Returns spawn options for the child process
   */
  protected getSpawnOptions(): any {
    return {
      stdio: ['inherit', 'pipe', 'pipe'],
      shell: true,
    };
  }

  /**
   * Handles stdout data from Claude process
   *
   * @param data - Raw stdout data
   */
  protected handleStdoutData(data: Buffer): void {
    const dataString = data.toString();
    this.buffer += dataString;

    this.log.debug('Received stdout data', {
      dataLength: dataString.length,
      bufferLength: this.buffer.length,
      content: dataString,
    });

    // Process complete lines
    const lines = this.buffer.split('\\n');
    this.buffer = lines.pop() || ''; // Keep incomplete line in buffer

    for (const line of lines) {
      if (line.trim()) {
        this.parseClaudeOutput(line);
      }
    }
  }

  /**
   * Handles stderr data from Claude process
   *
   * @param data - Raw stderr data
   */
  protected handleStderrData(data: Buffer): void {
    const errorMessage = data.toString();
    this.log.error('Process stderr', { message: errorMessage.trim() });
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
    // Process any remaining data in buffer
    if (this.buffer.trim()) {
      this.parseClaudeOutput(this.buffer);
    }

    const exitCode = code || 0;

    this.log.debug('Process exited', {
      exitCode,
      resultLength: this.result.length,
    });

    if (exitCode === 0) {
      this.log.info('Claude execution completed successfully', {
        prompt: prompt,
        resultLength: this.result.length,
      });
      resolve(this.result);
    } else {
      const error = new Error(`Claude process exited with code ${exitCode}`);
      this.log.error('Claude execution failed', {
        prompt: prompt,
        exitCode: exitCode,
        error: error.message,
      });
      reject(error);
    }
  }

  /**
   * Parses Claude output and handles logging
   *
   * @param data - Raw output data from Claude
   */
  private parseClaudeOutput(data: string): void {
    try {
      const event: LogEvent = JSON.parse(data);

      this.log.debug('Parsed Claude event', {
        type: event.type,
        subtype: event.subtype,
      });

      // Always capture result regardless of debug logging
      if (event.type === 'result' && event.result) {
        this.result = event.result;
        this.log.debug('Captured result', { resultLength: this.result.length });
      }

      // Log Claude activity with structured logging
      this.logClaudeActivity(event);
    } catch (error) {
      this.log.debug('Failed to parse Claude output', {
        data: data.substring(0, 100),
        error: error instanceof Error ? error.message : String(error),
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
          this.log.debug('Claude session initialized', {
            model: event.model,
            cwd: event.cwd,
            toolsCount: event.tools?.length || 0,
            sessionId: event.session_id,
          });
        }
        break;

      case 'assistant':
        if (event.message?.content) {
          for (const content of event.message.content) {
            if (content.type === 'text' && content.text) {
              this.log.debug('Claude is processing', {
                messageId: event.message.id,
                textLength: content.text.length,
              });
            } else if (content.type === 'tool_use' && content.name) {
              this.log.debug('Claude is using tool', {
                toolName: content.name,
                toolId: content.tool_use_id,
                messageId: event.message.id,
              });
            }
          }
        }
        break;

      case 'user':
        if (event.message?.content) {
          for (const content of event.message.content) {
            if (content.type === 'tool_result') {
              this.log.debug('Tool execution completed', {
                toolUseId: content.tool_use_id,
                hasContent: !!content.content,
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
            resultLength: event.result?.length || 0,
          };

          if (event.is_error) {
            this.log.error('Claude session ended with errors', sessionData);
          } else {
            this.log.info('Claude session completed successfully', sessionData);
          }
        }
        break;
    }
  }
}
