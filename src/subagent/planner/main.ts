import { ClaudeCode } from '../../agent/claude/main.js';
import { CLIAgent } from '../../agent/agent.js';
import { type ILogObj, Logger } from 'tslog';
import { type TaskKind, type TaskID } from '../types.js';

/**
 * Configuration options for the Planner
 */
export type PlannerConfig = {
  readonly timeoutMs?: number;
  readonly enableStructuredOutput?: boolean;
};

/**
 * Task step structure for decomposed tasks
 */
export type TaskStep = {
  readonly id: TaskID;
  readonly description: string;
  readonly priority: 'high' | 'medium' | 'low';
  readonly estimatedTime: string;
  readonly dependencies?: TaskID[];
  readonly kind: TaskKind;
};

/**
 * Planning result structure
 */
export type PlanningResult = {
  readonly summary: string;
  readonly totalSteps: number;
  readonly estimatedDuration: string;
  readonly steps: TaskStep[];
};

/**
 * Planner subagent that uses Claude Code to decompose user commands into detailed steps
 *
 * The Planner leverages Claude Code's task decomposition capabilities to break down
 * complex user instructions into actionable steps that can be executed by different agents.
 *
 * @example
 * ```typescript
 * const planner = new Planner();
 * const plan = await planner.createPlan("Build a REST API with authentication");
 * console.log(plan.steps);
 * ```
 */
export class Planner {
  private readonly log: Logger<ILogObj>;
  private readonly agent: CLIAgent;

  /**
   * Creates a new Planner instance
   *
   * @param config - Configuration options for the planner
   */
  constructor(config: PlannerConfig = {}) {
    this.log = new Logger({
      name: 'Planner',
      minLevel: this.getLogLevel(),
      type: process.env['NODE_ENV'] === 'production' ? 'json' : 'pretty',
      prettyLogTemplate:
        '{{yyyy}}.{{mm}}.{{dd}} {{hh}}:{{MM}}:{{ss}}\t{{logLevelName}}\t{{name}}\t',
    });

    // Initialize Claude Code with extended timeout for complex planning
    this.agent = new ClaudeCode({
      timeoutMs: config.timeoutMs ?? 300000, // Default: 5 minutes
    });
  }

  /**
   * Creates a detailed plan from a user command by decomposing it into actionable steps
   *
   * @param userCommand - The command or requirement from the user
   * @returns Promise that resolves with the detailed planning result
   */
  async createPlan(userCommand: string): Promise<PlanningResult> {
    if (!userCommand || userCommand.trim() === '') {
      const error = new Error('User command cannot be empty');
      this.log.error('Invalid user command', { error: error.message });
      throw error;
    }

    this.log.info('Starting task planning', {
      userCommand: userCommand,
      commandLength: userCommand.length,
    });

    const planningPrompt = this.buildPlanningPrompt(userCommand);

    try {
      const startTime = Date.now();
      const rawResult = await this.agent.execute(planningPrompt);
      const duration = Date.now() - startTime;

      this.log.debug('Planning completed', {
        rawResult,
        duration,
        resultLength: rawResult.length,
      });
      
      // Parse the structured result from Claude
      const planningResult = this.parsePlanningResult(rawResult);

      this.log.info('Task planning completed successfully', {
        userCommand: userCommand,
        totalSteps: planningResult.totalSteps,
        estimatedDuration: planningResult.estimatedDuration,
        duration,
      });

      return planningResult;
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      this.log.error('Task planning failed', {
        userCommand: userCommand,
        error: errorMessage,
      });
      throw new Error(`Failed to create plan: ${errorMessage}`);
    }
  }

  /**
   * Builds the structured prompt for Claude Code to decompose tasks
   *
   * @param userCommand - The original user command
   * @returns Formatted prompt string for Claude Code
   */
  private buildPlanningPrompt(userCommand: string): string {
    return `<role>
You are a technical project planner specializing in software development task decomposition.
</role>

<task>
Break down the following user command into detailed, actionable steps:

"${userCommand}"
</task>

<requirements>
1. Decompose into specific, measurable steps
2. Categorize each step:
   - research: Information gathering, specification analysis
   - implementation: Code writing, feature development
   - testing: Test creation, validation, debugging
   - documentation: Writing docs, comments, README files
   - analysis: Code review, performance analysis, security audit

3. Provide realistic time estimates
4. Identify dependencies between steps
</requirements>

<output_format>
Return ONLY a JSON object with this exact structure:

{
  "summary": "Brief description of what will be accomplished",
  "totalSteps": 5,
  "estimatedDuration": "2-3 hours",
  "steps": [
    {
      "id": "step-1",
      "description": "Specific action to take",
      "priority": "high|medium|low",
      "estimatedTime": "30 minutes",
      "dependencies": ["step-id-if-any"],
      "kind": "research|implementation|testing|documentation|analysis"
    }
  ]
}
</output_format>

<important>
Return ONLY the JSON object, no additional text or explanations.
</important>`;
  }

  /**
   * Parses the Claude Code result into structured planning data
   *
   * @param rawResult - Raw string result from Claude Code
   * @returns Parsed planning result
   */
  private parsePlanningResult(rawResult: string): PlanningResult {
    try {
      // Clean the result and extract JSON
      let cleanedResult = rawResult.trim();
      
      // Handle code blocks (```json...```) 
      const codeBlockMatch = cleanedResult.match(/```json\s*([\s\S]*?)\s*```/);
      if (codeBlockMatch && codeBlockMatch[1]) {
        cleanedResult = codeBlockMatch[1].trim();
      }
      
      // Handle escaped JSON strings (from Claude's result field)
      // If the result is an escaped JSON string, unescape it
      if (cleanedResult.startsWith('\\"') && cleanedResult.endsWith('\\"')) {
        try {
          cleanedResult = JSON.parse(cleanedResult);
        } catch (unescapeError) {
          this.log.debug('Failed to unescape JSON string, proceeding with original', {
            error: unescapeError instanceof Error ? unescapeError.message : String(unescapeError),
          });
        }
      }
      
      let jsonString = cleanedResult;

      // Handle cases where Claude might include extra text before/after JSON
      const jsonMatch = cleanedResult.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        jsonString = jsonMatch[0];
      }

      const parsed = JSON.parse(jsonString) as PlanningResult;

      // Validate the structure
      this.validatePlanningResult(parsed);

      this.log.debug('Successfully parsed planning result', {
        totalSteps: parsed.totalSteps,
        stepsCount: parsed.steps.length,
        summary: parsed.summary.substring(0, 100),
      });

      return parsed;
    } catch (error) {
      this.log.error('Failed to parse planning result', {
        error: error instanceof Error ? error.message : String(error),
        resultPreview: rawResult.substring(0, 200),
      });
      throw new Error(`Failed to parse planning result: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  /**
   * Validates the structure of the parsed planning result
   *
   * @param result - Parsed planning result to validate
   * @throws Error if validation fails
   */
  private validatePlanningResult(result: any): asserts result is PlanningResult {
    if (typeof result !== 'object' || result === null) {
      throw new Error('Planning result must be an object');
    }

    if (typeof result.summary !== 'string') {
      throw new Error('Planning result must have a summary string');
    }

    if (typeof result.totalSteps !== 'number') {
      throw new Error('Planning result must have a totalSteps number');
    }

    if (typeof result.estimatedDuration !== 'string') {
      throw new Error('Planning result must have an estimatedDuration string');
    }

    if (!Array.isArray(result.steps)) {
      throw new Error('Planning result must have a steps array');
    }

    for (const [index, step] of result.steps.entries()) {
      if (typeof step.id !== 'string') {
        throw new Error(`Step ${index} must have an id string`);
      }
      if (typeof step.description !== 'string') {
        throw new Error(`Step ${index} must have a description string`);
      }
      if (!['high', 'medium', 'low'].includes(step.priority)) {
        throw new Error(`Step ${index} must have a valid priority`);
      }
      if (!['research', 'implementation', 'testing', 'documentation', 'analysis'].includes(step.kind)) {
        throw new Error(`Step ${index} must have a valid kind`);
      }
    }
  }

  /**
   * Determines log level based on environment variables
   */
  private getLogLevel(): number {
    const logLevel = process.env['LOG_LEVEL'] || process.env['LOGLEVEL'] || 'info';

    switch (logLevel.toLowerCase()) {
      case 'trace':
        return 0;
      case 'debug':
        return 1;
      case 'info':
        return 3;
      case 'warn':
        return 4;
      case 'error':
        return 5;
      case 'fatal':
        return 6;
      default:
        return 3; // info
    }
  }
}