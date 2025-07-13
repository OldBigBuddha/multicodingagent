#!/usr/bin/env node

import { Logger } from 'tslog';
import { Planner } from '../subagent/planner/main.js';

// Initialize logger
const log = new Logger({
  name: 'PlanningPoC',
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
    log.error('Usage: pnpm tsx src/poc/planning.ts "your task description"');
    log.error('');
    log.error('Examples:');
    log.error('  pnpm tsx src/poc/planning.ts "Build a REST API with authentication"');
    log.error('  pnpm tsx src/poc/planning.ts "Create a React dashboard with charts"');
    process.exit(1);
  }

  const userPrompt = args.join(' ');

  log.info('Starting task planning PoC', {
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
        canStartImmediately: !step.dependencies || step.dependencies.length === 0
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

    log.info('Task planning completed successfully', {
      success: true,
      totalSteps: planningResult.totalSteps,
      duration: duration
    });

    log.info('Task planning PoC completed successfully', {
      userPrompt: userPrompt,
      totalSteps: planningResult.totalSteps,
      estimatedDuration: planningResult.estimatedDuration,
      planningDuration: duration,
    });

  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    
    log.error('Planning failed', {
      error: errorMessage,
      userPrompt: userPrompt
    });
    
    log.error('Task planning PoC failed', {
      userPrompt: userPrompt,
      error: errorMessage,
      stack: error instanceof Error ? error.stack : undefined,
    });
    
    process.exit(1);
  }
}

main().catch((error) => {
  log.fatal('Fatal application error in planning PoC', {
    error: error instanceof Error ? error.message : String(error),
    stack: error instanceof Error ? error.stack : undefined,
  });
  log.fatal('Fatal error occurred', {
    error: error instanceof Error ? error.message : String(error)
  });
  process.exit(1);
});