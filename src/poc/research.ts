#!/usr/bin/env node

import { Logger } from 'tslog';
import { Planner } from '../subagent/planner/main.js';
import { Researcher } from '../subagent/researcher/main.js';

// Initialize logger
const log = new Logger({
  name: 'ResearchPoC',
  minLevel: getLogLevel(),
  type: process.env['NODE_ENV'] === 'production' ? 'json' : 'pretty',
  prettyLogTemplate: '{{yyyy}}.{{mm}}.{{dd}} {{hh}}:{{MM}}:{{ss}}\\t{{logLevelName}}\\t{{name}}\\t',
});

/**
 * Determines log level based on environment variables
 */
function getLogLevel(): number {
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

/**
 * Main function that processes CLI arguments and runs task planning
 */
async function main(): Promise<void> {
  // Get user prompt from command line arguments
  const args = process.argv.slice(2);
  
  if (args.length === 0) {
    log.error('Error: Please provide a prompt as a command line argument');
    log.error('');
    log.error('Usage: pnpm tsx src/poc/research.ts "your task description"');
    log.error('');
    log.error('Examples:');
    log.error('  pnpm tsx src/poc/research.ts "Research OAuth2 authentication patterns"');
    log.error('  pnpm tsx src/poc/research.ts "Investigate React state management solutions"');
    process.exit(1);
  }

  const userPrompt = args.join(' ');

  log.info('Starting research workflow PoC', {
    userPrompt: userPrompt,
    promptLength: userPrompt.length,
  });

  try {
    // Initialize planner with extended timeout for complex tasks
    const planner = new Planner({
      timeoutMs: 600000, // 10 minutes
      enableStructuredOutput: true,
    });

    log.info('Starting planning task', { userPrompt });

    const startTime = Date.now();
    const planningResult = await planner.createPlan(userPrompt);
    const duration = Date.now() - startTime;

    // Display planning results with comprehensive details
    log.info('Planning results', {
      summary: planningResult.summary,
      totalSteps: planningResult.totalSteps,
      estimatedDuration: planningResult.estimatedDuration,
      planningTimeSeconds: Math.round(duration / 1000),
      planningResult: planningResult
    });

    // Check if first task is web_research and execute it
    const firstTask = planningResult.steps[0];
    if (firstTask && firstTask.kind === 'web_research') {
      log.info('First task is web_research type, executing with Researcher subagent', {
        taskId: firstTask.id,
        description: firstTask.description,
        priority: firstTask.priority,
        estimatedTime: firstTask.estimatedTime,
      });

      try {
        // Initialize researcher with appropriate timeout
        const researcher = new Researcher({
          timeoutMs: 600000, // 10 minutes
          maxDepth: 3,
          includeSources: true,
        });

        const researchStartTime = Date.now();
        
        // Execute research task
        const researchResult = await researcher.investigate({
          query: firstTask.description,
          scope: firstTask.priority === 'high' ? 'comprehensive' : 'detailed',
          focus: [], // Could be extracted from task context
          constraints: [], // Could be extracted from task constraints
        });

        const researchDuration = Date.now() - researchStartTime;

        log.info('Research task completed successfully', {
          investigationId: researchResult.investigationId,
          query: researchResult.query,
          totalFindings: researchResult.totalFindings,
          researchDurationMs: researchDuration,
          executionTime: researchResult.executionTime,
        });

        // Log research findings
        for (const [index, finding] of researchResult.findings.entries()) {
          log.info(`Research Finding ${index + 1}/${researchResult.totalFindings}`, {
            findingNumber: index + 1,
            id: finding.id,
            category: finding.category,
            summary: finding.summary,
            implicationsCount: finding.implications.length,
            sourcesCount: finding.sources.length,
          });
        }

        // Log research recommendations
        if (researchResult.recommendations.length > 0) {
          log.info('Research Recommendations', {
            recommendationsCount: researchResult.recommendations.length,
            recommendations: researchResult.recommendations,
          });
        }

        // Log related queries for further investigation
        if (researchResult.relatedQueries.length > 0) {
          log.info('Related Investigation Topics', {
            relatedQueriesCount: researchResult.relatedQueries.length,
            relatedQueries: researchResult.relatedQueries,
          });
        }

        // Log research statistics
        const categoryDistribution = researchResult.findings.reduce((acc, finding) => {
          acc[finding.category] = (acc[finding.category] || 0) + 1;
          return acc;
        }, {} as Record<string, number>);

        log.info('Research statistics', {
          findingsByCategory: categoryDistribution,
          averageImplicationsPerFinding: Math.round(
            researchResult.findings.reduce((sum, f) => sum + f.implications.length, 0) / 
            Math.max(researchResult.totalFindings, 1)
          ),
          averageSourcesPerFinding: Math.round(
            researchResult.findings.reduce((sum, f) => sum + f.sources.length, 0) / 
            Math.max(researchResult.totalFindings, 1)
          ),
        });

      } catch (researchError) {
        const researchErrorMessage = researchError instanceof Error ? researchError.message : String(researchError);
        
        log.error('Research task execution failed', {
          taskId: firstTask.id,
          taskDescription: firstTask.description,
          error: researchErrorMessage,
          stack: researchError instanceof Error ? researchError.stack : undefined,
        });

        log.warn('Continuing with planning results despite research failure');
      }
    } else {
      log.info('First task is not web_research type, skipping researcher execution', {
        firstTaskKind: firstTask?.kind || 'none',
        firstTaskId: firstTask?.id || 'none',
        totalTasks: planningResult.totalSteps,
      });
    }

    // Log detailed step information
    for (const [index, step] of planningResult.steps.entries()) {
      log.info(`Step ${index + 1}/${planningResult.totalSteps}`, {
        stepNumber: index + 1,
        description: step.description,
        id: step.id,
        kind: step.kind,
        priority: step.priority,
        estimatedTime: step.estimatedTime,
        dependencies: step.dependencies || [],
        dependencyCount: step.dependencies?.length || 0,
        canStartImmediately: !step.dependencies || step.dependencies.length === 0,
        wasExecuted: index === 0 && step.kind === 'web_research',
      });
    }
    
    // Log summary statistics
    const kindCounts = planningResult.steps.reduce((acc, step) => {
      acc[step.kind] = (acc[step.kind] || 0) + 1;
      return acc;
    }, {} as Record<string, number>);
    
    const priorityCounts = planningResult.steps.reduce((acc, step) => {
      acc[step.priority] = (acc[step.priority] || 0) + 1;
      return acc;
    }, {} as Record<string, number>);
    
    const stepsWithDependencies = planningResult.steps.filter(step => 
      step.dependencies && step.dependencies.length > 0
    ).length;
    
    const independentSteps = planningResult.totalSteps - stepsWithDependencies;
    
    log.info('Planning statistics', {
      stepsByKind: kindCounts,
      stepsByPriority: priorityCounts,
      dependencyAnalysis: {
        independentSteps,
        dependentSteps: stepsWithDependencies,
        dependencyRatio: Math.round((stepsWithDependencies / planningResult.totalSteps) * 100)
      }
    });

    log.info('Research workflow completed successfully', {
      success: true,
      totalSteps: planningResult.totalSteps,
      duration: duration,
      firstTaskExecuted: firstTask?.kind === 'web_research',
      researchTaskKind: firstTask?.kind || 'none',
    });

    log.info('Research PoC completed successfully', {
      userPrompt: userPrompt,
      totalSteps: planningResult.totalSteps,
      estimatedDuration: planningResult.estimatedDuration,
      planningDuration: duration,
      workflowType: firstTask?.kind === 'web_research' ? 'research-execution' : 'planning-only',
    });

  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    
    log.error('Research workflow failed', {
      error: errorMessage,
      userPrompt: userPrompt
    });
    
    log.error('Research PoC failed', {
      userPrompt: userPrompt,
      error: errorMessage,
      stack: error instanceof Error ? error.stack : undefined,
    });
    
    process.exit(1);
  }
}

main().catch((error) => {
  log.fatal('Fatal application error in research PoC', {
    error: error instanceof Error ? error.message : String(error),
    stack: error instanceof Error ? error.stack : undefined,
  });
  log.fatal('Fatal error occurred', {
    error: error instanceof Error ? error.message : String(error)
  });
  process.exit(1);
});