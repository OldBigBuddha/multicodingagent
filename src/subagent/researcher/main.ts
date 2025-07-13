import { Gemini } from '../../model/gemini/main.js';
import { CLIAgent } from '../../model/agent.js';
import { type ILogObj, Logger } from 'tslog';
import { type TaskID } from '../types.js';

/**
 * Configuration options for the Researcher
 */
export type ResearcherConfig = {
  readonly timeoutMs?: number;
  readonly maxDepth?: number;
  readonly includeSources?: boolean;
};

/**
 * Research topic structure for investigation requests
 */
export type ResearchTopic = {
  readonly query: string;
  readonly scope?: 'overview' | 'detailed' | 'comprehensive';
  readonly focus?: string[];
  readonly constraints?: string[];
};

/**
 * Research source structure for tracking information sources
 */
export type ResearchSource = {
  readonly type: 'documentation' | 'codebase' | 'specification' | 'external' | 'analysis';
  readonly title: string;
  readonly relevance: 'high' | 'medium' | 'low';
  readonly url?: string;
  readonly section?: string;
};

/**
 * Research finding structure for individual discoveries
 */
export type ResearchFinding = {
  readonly id: TaskID;
  readonly category: string;
  readonly summary: string;
  readonly details: string;
  readonly implications: string[];
  readonly sources: ResearchSource[];
};

/**
 * Research result structure for AI-readable output
 */
export type ResearchResult = {
  readonly investigationId: TaskID;
  readonly query: string;
  readonly scope: string;
  readonly executionTime: string;
  readonly totalFindings: number;
  readonly findings: ResearchFinding[];
  readonly recommendations: string[];
  readonly relatedQueries: string[];
};

/**
 * Researcher subagent that uses Gemini to investigate and summarize information
 *
 * The Researcher leverages Gemini's analysis capabilities to gather, process,
 * and structure information in AI-readable formats for consumption by other subagents.
 *
 * @example
 * ```typescript
 * const researcher = new Researcher();
 * const result = await researcher.investigate({
 *   query: "How to implement OAuth2 authentication in Node.js",
 *   scope: "comprehensive"
 * });
 * console.log(result.findings);
 * ```
 */
export class Researcher {
  private readonly log: Logger<ILogObj>;
  private readonly agent: CLIAgent;
  private readonly config: Required<ResearcherConfig>;

  /**
   * Creates a new Researcher instance
   *
   * @param config - Configuration options for the researcher
   */
  constructor(config: ResearcherConfig = {}) {
    this.config = {
      timeoutMs: config.timeoutMs ?? 600000, // Default: 10 minutes
      maxDepth: config.maxDepth ?? 5,
      includeSources: config.includeSources ?? true,
    };

    this.log = new Logger({
      name: 'Researcher',
      minLevel: this.getLogLevel(),
      type: process.env['NODE_ENV'] === 'production' ? 'json' : 'pretty',
      prettyLogTemplate:
        '{{yyyy}}.{{mm}}.{{dd}} {{hh}}:{{MM}}:{{ss}}\t{{logLevelName}}\t{{name}}\t',
    });

    // Initialize Gemini with extended timeout for research tasks
    this.agent = new Gemini({
      timeoutMs: this.config.timeoutMs,
    });
  }

  /**
   * Investigates a research topic and returns structured findings
   *
   * @param topic - The research topic to investigate
   * @returns Promise that resolves with structured research results
   */
  async investigate(topic: ResearchTopic): Promise<ResearchResult> {
    if (!topic.query || topic.query.trim() === '') {
      const error = new Error('Research query cannot be empty');
      this.log.error('Invalid research query', { error: error.message });
      throw error;
    }

    const investigationId = this.generateInvestigationId();
    
    this.log.info('Starting research investigation', {
      investigationId,
      query: topic.query,
      scope: topic.scope || 'overview',
      focusAreas: topic.focus?.length || 0,
      constraints: topic.constraints?.length || 0,
    });

    const researchPrompt = this.buildResearchPrompt(topic);

    try {
      const startTime = Date.now();
      const rawResult = await this.agent.execute(researchPrompt);
      const duration = Date.now() - startTime;

      this.log.debug('Research completed', {
        investigationId,
        duration,
        resultLength: rawResult.length,
      });
      
      // Parse the structured result from Gemini
      const researchResult = this.parseResearchResult(rawResult, topic, investigationId, duration);

      this.log.info('Research investigation completed successfully', {
        investigationId,
        query: topic.query,
        totalFindings: researchResult.totalFindings,
        duration,
      });

      return researchResult;
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      this.log.error('Research investigation failed', {
        investigationId,
        query: topic.query,
        error: errorMessage,
      });
      throw new Error(`Failed to complete research investigation: ${errorMessage}`);
    }
  }

  /**
   * Builds the structured prompt for Gemini to conduct research
   *
   * @param topic - The research topic
   * @returns Formatted prompt string for Gemini
   */
  private buildResearchPrompt(topic: ResearchTopic): string {
    const scope = topic.scope || 'overview';
    const focusSection = topic.focus && topic.focus.length > 0 
      ? `\n\nFocus specifically on these areas:\n${topic.focus.map(f => `- ${f}`).join('\n')}`
      : '';
    
    const constraintsSection = topic.constraints && topic.constraints.length > 0
      ? `\n\nConstraints and limitations:\n${topic.constraints.map(c => `- ${c}`).join('\n')}`
      : '';

    return `<role>
You are a technical researcher with expertise in software development, architecture, and technology analysis. Your role is to investigate topics thoroughly, identify key insights, and provide structured findings that help development teams make informed decisions.
</role>

<task>
Research: ${topic.query}
</task>

<requirements>
Find key information and provide practical findings.
${focusSection}${constraintsSection}
</requirements>

<output_format>
Return ONLY a JSON object with this exact structure:

{
  "investigationSummary": {
    "query": "${topic.query}",
    "scope": "${scope}",
    "totalFindings": 0
  },
  "findings": [
    {
      "id": "finding-1",
      "category": "Category Name",
      "summary": "Brief summary of the finding",
      "details": "Detailed explanation with technical specifics",
      "implications": ["Practical implication 1", "Practical implication 2"],
      "sources": [
        {
          "type": "documentation|codebase|specification|external|analysis",
          "title": "Source Title", 
          "relevance": "high|medium|low",
          "url": "URL if available",
          "section": "Section if applicable"
        }
      ]
    }
  ],
  "recommendations": ["Actionable recommendation 1", "Actionable recommendation 2"],
  "relatedQueries": ["Related investigation topic 1", "Related investigation topic 2"]
}
</output_format>

<important>
Return ONLY the JSON object, no additional text or explanations.
Do not mention saving files, writing to disk, or file operations.
</important>`;
  }

  /**
   * Parses the Gemini research result into structured data
   *
   * @param rawResult - Raw string result from Gemini
   * @param topic - Original research topic
   * @param investigationId - Investigation identifier
   * @param duration - Execution duration in milliseconds
   * @returns Parsed research result
   */
  private parseResearchResult(
    rawResult: string, 
    topic: ResearchTopic, 
    investigationId: string, 
    duration: number
  ): ResearchResult {
    try {
      // Clean the result and extract JSON content
      let cleanedResult = rawResult.trim();
      
      // Handle code blocks (```json...```) 
      const codeBlockMatch = cleanedResult.match(/```json\s*([\s\S]*?)\s*```/);
      if (codeBlockMatch && codeBlockMatch[1]) {
        cleanedResult = codeBlockMatch[1].trim();
      }
      
      // Handle escaped JSON strings (from Gemini's result field)
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

      // Handle cases where Gemini might include extra text before/after JSON
      const jsonMatch = cleanedResult.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        jsonString = jsonMatch[0];
      }

      // Parse the JSON structure
      const result = this.parseJsonStructure(jsonString);
      
      // Validate and construct the research result
      const researchResult: ResearchResult = {
        investigationId: investigationId as TaskID,
        query: topic.query,
        scope: topic.scope || 'overview',
        executionTime: `${duration}ms`,
        totalFindings: result.findings?.length || 0,
        findings: result.findings || [],
        recommendations: result.recommendations || [],
        relatedQueries: result.relatedQueries || [],
      };

      this.validateResearchResult(researchResult);

      this.log.debug('Successfully parsed research result', {
        investigationId,
        totalFindings: researchResult.totalFindings,
        recommendationsCount: researchResult.recommendations.length,
        relatedQueriesCount: researchResult.relatedQueries.length,
      });

      return researchResult;
    } catch (error) {
      this.log.error('Failed to parse research result', {
        investigationId,
        error: error instanceof Error ? error.message : String(error),
        resultPreview: rawResult.substring(0, 300),
      });
      throw new Error(`Failed to parse research result: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  /**
   * JSON structure parser for research results
   * 
   * @param jsonContent - JSON content to parse
   * @returns Parsed structure object
   */
  private parseJsonStructure(jsonContent: string): any {
    const parsed = JSON.parse(jsonContent);
    
    // Validate the structure matches expected format
    if (!parsed.investigationSummary || !Array.isArray(parsed.findings)) {
      throw new Error('Invalid JSON structure: missing required fields');
    }

    // Convert to internal format
    const result: any = {
      findings: [],
      recommendations: parsed.recommendations || [],
      relatedQueries: parsed.relatedQueries || []
    };

    // Process findings
    if (parsed.findings && Array.isArray(parsed.findings)) {
      result.findings = parsed.findings.map((finding: any, index: number) => {
        const processedFinding: ResearchFinding = {
          id: (finding.id || `finding-${index + 1}`) as TaskID,
          category: finding.category || 'General',
          summary: finding.summary || '',
          details: finding.details || '',
          implications: Array.isArray(finding.implications) ? finding.implications : [],
          sources: Array.isArray(finding.sources) ? finding.sources.map((source: any) => ({
            type: source.type || 'analysis',
            title: source.title || 'Unknown Source',
            relevance: source.relevance || 'medium',
            ...(source.url && { url: source.url }),
            ...(source.section && { section: source.section })
          })) : [],
        };

        return processedFinding;
      });
    }

    return result;
  }


  /**
   * Validates the structure of the parsed research result
   *
   * @param result - Parsed research result to validate
   * @throws Error if validation fails
   */
  private validateResearchResult(result: any): asserts result is ResearchResult {
    if (typeof result !== 'object' || result === null) {
      throw new Error('Research result must be an object');
    }

    if (typeof result.investigationId !== 'string') {
      throw new Error('Research result must have an investigationId string');
    }

    if (typeof result.query !== 'string') {
      throw new Error('Research result must have a query string');
    }

    if (typeof result.totalFindings !== 'number') {
      throw new Error('Research result must have a totalFindings number');
    }

    if (!Array.isArray(result.findings)) {
      throw new Error('Research result must have a findings array');
    }

    if (!Array.isArray(result.recommendations)) {
      throw new Error('Research result must have a recommendations array');
    }

    if (!Array.isArray(result.relatedQueries)) {
      throw new Error('Research result must have a relatedQueries array');
    }

    for (const [index, finding] of result.findings.entries()) {
      if (typeof finding.id !== 'string') {
        throw new Error(`Finding ${index} must have an id string`);
      }
      if (typeof finding.summary !== 'string') {
        throw new Error(`Finding ${index} must have a summary string`);
      }
    }
  }

  /**
   * Generates a unique investigation ID
   */
  private generateInvestigationId(): string {
    const timestamp = Date.now();
    const random = Math.random().toString(36).substring(2, 8);
    return `investigation-${timestamp}-${random}`;
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