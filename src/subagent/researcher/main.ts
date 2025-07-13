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
  readonly confidence: 'high' | 'medium' | 'low';
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
  readonly confidenceDistribution: Record<string, number>;
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

    const researchPrompt = this.buildResearchPrompt(topic, investigationId);

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
   * @param investigationId - Unique investigation identifier
   * @returns Formatted prompt string for Gemini
   */
  private buildResearchPrompt(topic: ResearchTopic, investigationId: string): string {
    const scope = topic.scope || 'overview';
    const focusSection = topic.focus && topic.focus.length > 0 
      ? `\n\nFocus specifically on these areas:\n${topic.focus.map(f => `- ${f}`).join('\n')}`
      : '';
    
    const constraintsSection = topic.constraints && topic.constraints.length > 0
      ? `\n\nConstraints and limitations:\n${topic.constraints.map(c => `- ${c}`).join('\n')}`
      : '';

    return `<research_task>
<investigation_id>${investigationId}</investigation_id>
<query>${topic.query}</query>
<scope>${scope}</scope>
${focusSection}${constraintsSection}
</research_task>

<instructions>
You are a technical researcher conducting a ${scope} investigation. Your task is to gather, analyze, and structure information about the given query for consumption by other AI agents.

Research Requirements:
1. Gather comprehensive information from multiple perspectives
2. Analyze technical feasibility and implementation approaches
3. Identify best practices, patterns, and potential pitfalls
4. Structure findings with clear categorization and confidence levels
5. Provide actionable recommendations and related investigation paths

Output Format:
Your response must be structured with XML-like tags for AI parsing. Use this exact format:

<research_results>
<investigation_summary>
<query>${topic.query}</query>
<scope>${scope}</scope>
<execution_time>DURATION_IN_MS</execution_time>
<total_findings>NUMBER</total_findings>
<confidence_distribution>
<high>NUMBER</high>
<medium>NUMBER</medium>
<low>NUMBER</low>
</confidence_distribution>
</investigation_summary>

<findings>
<finding id="finding-1">
<category>CATEGORY_NAME</category>
<summary>Brief summary of the finding</summary>
<details>Detailed explanation with technical specifics</details>
<confidence>high|medium|low</confidence>
<implications>
<implication>Practical implication 1</implication>
<implication>Practical implication 2</implication>
</implications>
<sources>
<source type="documentation|codebase|specification|external|analysis" relevance="high|medium|low" title="Source Title" url="URL_IF_AVAILABLE" section="SECTION_IF_AVAILABLE" />
</sources>
</finding>
<!-- Additional findings -->
</findings>

<recommendations>
<recommendation priority="high|medium|low">Actionable recommendation 1</recommendation>
<recommendation priority="high|medium|low">Actionable recommendation 2</recommendation>
</recommendations>

<related_queries>
<query>Related investigation topic 1</query>
<query>Related investigation topic 2</query>
</related_queries>
</research_results>

Analysis Depth:
- ${scope === 'overview' ? 'Provide broad coverage with key insights' : ''}
- ${scope === 'detailed' ? 'Include technical implementation details and examples' : ''}
- ${scope === 'comprehensive' ? 'Exhaustive analysis with multiple approaches and edge cases' : ''}

Quality Standards:
- Each finding must have clear technical relevance
- Confidence levels must reflect information reliability
- Sources should be traceable and authoritative
- Implications should be practically actionable
- Recommendations should be prioritized by impact and feasibility
</instructions>

<critical>
Return ONLY the structured XML response. No additional commentary or explanations outside the tags.
</critical>`;
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
      // Clean the result and extract XML content
      let cleanedResult = rawResult.trim();
      
      // Handle potential code blocks or extra formatting
      const xmlMatch = cleanedResult.match(/<research_results>[\s\S]*<\/research_results>/);
      if (xmlMatch) {
        cleanedResult = xmlMatch[0];
      }

      // Parse the XML-like structure (simplified parsing for structured data)
      const result = this.parseXmlStructure(cleanedResult);
      
      // Validate and construct the research result
      const researchResult: ResearchResult = {
        investigationId: investigationId as TaskID,
        query: topic.query,
        scope: topic.scope || 'overview',
        executionTime: `${duration}ms`,
        totalFindings: result.findings?.length || 0,
        confidenceDistribution: result.confidenceDistribution || { high: 0, medium: 0, low: 0 },
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
   * Simplified XML-like structure parser for research results
   * 
   * @param xmlContent - XML-like content to parse
   * @returns Parsed structure object
   */
  private parseXmlStructure(xmlContent: string): any {
    const result: any = {
      findings: [],
      recommendations: [],
      relatedQueries: [],
      confidenceDistribution: { high: 0, medium: 0, low: 0 }
    };

    // Parse findings
    const findingsMatch = xmlContent.match(/<findings>([\s\S]*?)<\/findings>/);
    if (findingsMatch) {
      const findingsContent = findingsMatch[1];
      const findingMatches = findingsContent?.match(/<finding[^>]*>[\s\S]*?<\/finding>/g);
      
      if (findingMatches) {
        result.findings = findingMatches.map((findingXml, index) => {
          const finding: ResearchFinding = {
            id: `finding-${index + 1}` as TaskID,
            category: this.extractTextBetweenTags(findingXml, 'category') || 'General',
            summary: this.extractTextBetweenTags(findingXml, 'summary') || '',
            details: this.extractTextBetweenTags(findingXml, 'details') || '',
            confidence: (this.extractTextBetweenTags(findingXml, 'confidence') || 'medium') as 'high' | 'medium' | 'low',
            implications: this.extractArrayBetweenTags(findingXml, 'implications', 'implication'),
            sources: this.extractSources(findingXml),
          };

          // Update confidence distribution
          result.confidenceDistribution[finding.confidence]++;

          return finding;
        });
      }
    }

    // Parse recommendations
    const recommendationsMatch = xmlContent.match(/<recommendations>([\s\S]*?)<\/recommendations>/);
    if (recommendationsMatch) {
      const recommendationMatches = recommendationsMatch[1]?.match(/<recommendation[^>]*>([^<]*)<\/recommendation>/g);
      if (recommendationMatches) {
        result.recommendations = recommendationMatches.map(match => {
          const content = match.match(/>([^<]*)</) ?.[1] || '';
          return content.trim();
        });
      }
    }

    // Parse related queries
    const relatedMatch = xmlContent.match(/<related_queries>([\s\S]*?)<\/related_queries>/);
    if (relatedMatch) {
      const queryMatches = relatedMatch[1]?.match(/<query>([^<]*)<\/query>/g);
      if (queryMatches) {
        result.relatedQueries = queryMatches.map(match => {
          const content = match.match(/>([^<]*)</) ?.[1] || '';
          return content.trim();
        });
      }
    }

    return result;
  }

  /**
   * Extracts text content between XML tags
   */
  private extractTextBetweenTags(xml: string, tagName: string): string | null {
    const match = xml.match(new RegExp(`<${tagName}>([\\s\\S]*?)<\\/${tagName}>`));
    return match ? match[1]?.trim() || null : null;
  }

  /**
   * Extracts array of text content between XML tags
   */
  private extractArrayBetweenTags(xml: string, containerTag: string, itemTag: string): string[] {
    const containerMatch = xml.match(new RegExp(`<${containerTag}>[\\s\\S]*?<\\/${containerTag}>`));
    if (!containerMatch) return [];

    const itemMatches = containerMatch[0]?.match(new RegExp(`<${itemTag}>([^<]*)<\\/${itemTag}>`, 'g'));
    if (!itemMatches) return [];

    return itemMatches.map(match => {
      const content = match.match(new RegExp(`>([^<]*)<`))?.[1] || '';
      return content.trim();
    });
  }

  /**
   * Extracts source information from XML
   */
  private extractSources(xml: string): ResearchSource[] {
    const sourcesMatch = xml.match(/<sources>([\s\S]*?)<\/sources>/);
    if (!sourcesMatch) return [];

    const sourceMatches = sourcesMatch[1]?.match(/<source[^>]*\/>/g);
    if (!sourceMatches) return [];

    return sourceMatches.map(sourceXml => {
      const type = this.extractAttribute(sourceXml, 'type') as ResearchSource['type'] || 'analysis';
      const relevance = this.extractAttribute(sourceXml, 'relevance') as ResearchSource['relevance'] || 'medium';
      const title = this.extractAttribute(sourceXml, 'title') || 'Unknown Source';
      const url = this.extractAttribute(sourceXml, 'url');
      const section = this.extractAttribute(sourceXml, 'section');

      return { 
        type, 
        relevance, 
        title, 
        ...(url && { url }), 
        ...(section && { section }) 
      };
    });
  }

  /**
   * Extracts attribute value from XML tag
   */
  private extractAttribute(xml: string, attrName: string): string | undefined {
    const match = xml.match(new RegExp(`${attrName}=\"([^\"]*)\"`));
    return match ? match[1] : undefined;
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
      if (!['high', 'medium', 'low'].includes(finding.confidence)) {
        throw new Error(`Finding ${index} must have a valid confidence level`);
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