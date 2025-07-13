#!/usr/bin/env node

import { Logger } from 'tslog';
import { ClaudeCode } from './agent/claude/main.js';
import { Gemini } from './agent/gemini/main.js';

// Initialize logger
const log = new Logger({
  name: 'MultiCodingAgent',
  minLevel: getLogLevel(),
  type: process.env['NODE_ENV'] === 'production' ? 'json' : 'pretty',
  prettyLogTemplate: '{{yyyy}}.{{mm}}.{{dd}} {{hh}}:{{MM}}:{{ss}}\t{{logLevelName}}\t{{name}}\t',
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
 * Executes a prompt using Claude Code
 *
 * @param prompt - The prompt text to send to Claude
 * @returns Promise that resolves with the result string
 */
async function useClaude(prompt: string): Promise<string> {
  log.info('Processing prompt with Claude', { promptLength: prompt.length });

  const claude = new ClaudeCode({ timeoutMs: 600000 }); // 10 minutes timeout

  const startTime = Date.now();
  const result = await claude.execute(prompt);
  const duration = Date.now() - startTime;

  log.info('Claude execution completed', {
    duration,
    resultLength: result.length,
    success: true,
  });

  return result;
}

/**
 * Executes a prompt using Gemini Code
 *
 * @param prompt - The prompt text to send to Gemini
 * @returns Promise that resolves with the result string
 */
async function useGemini(prompt: string): Promise<string> {
  log.info('Processing prompt with Gemini', { promptLength: prompt.length });

  const gemini = new Gemini({ timeoutMs: 600000 }); // 10 minutes timeout

  const startTime = Date.now();
  const result = await gemini.execute(prompt);
  const duration = Date.now() - startTime;

  log.info('Gemini execution completed', {
    duration,
    resultLength: result.length,
    success: true,
  });

  return result;
}

/**
 * Main function that always executes hardcoded multi-agent workflow
 * Gemini researches OCI spec, Claude Code implements Go parser
 */
async function main(): Promise<void> {
  log.info('🚀 Starting hardcoded multi-agent workflow for OCI config.json parser');

  // Hardcoded research prompt for Gemini
  const researchPrompt =
    'Research the OCI Runtime Specification and identify all required fields in the config.json file. Provide the field names, their data types, and any validation requirements.';

  try {
    // Multi-agent workflow implementation expanded inline
    log.info('Starting multi-agent workflow', {
      researchPromptLength: researchPrompt.length,
    });

    // Phase 1: Research with Gemini
    log.info('Phase 1: Using Gemini for research');
    const researchResult = await useGemini(researchPrompt);

    console.log('\n🔍 Research Results (Gemini):');
    console.log('-'.repeat(50));
    console.log(researchResult);
    console.log('-'.repeat(50));

    // Generate implementation prompt dynamically based on Gemini's research
    const implementationPrompt = `Write ./dist/oci_config.go file with Go code for JSON config parsing. Based on the following research results:

${researchResult}

Create a Go package that implements parsing and validation for the above specification. Include appropriate struct definitions with JSON tags, parsing functions, and validation logic based on the research findings.`;

    log.info('Generated dynamic implementation prompt', {
      implementationPromptLength: implementationPrompt.length,
    });

    // Phase 2: Implementation with Claude Code
    log.info('Phase 2: Using Claude Code for implementation');

    const implementationResult = await useClaude(implementationPrompt);

    console.log('\n⚙️ Implementation Results (Claude Code):');
    console.log('-'.repeat(50));
    console.log(implementationResult);
    console.log('-'.repeat(50));

    log.info('Multi-agent workflow completed successfully');
    log.info('✅ Multi-agent workflow completed successfully');
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    log.error('Multi-agent workflow failed', {
      error: errorMessage,
      stack: error instanceof Error ? error.stack : undefined,
    });
    log.error('❌ Multi-agent workflow failed', { error: errorMessage });
    console.error('Error:', errorMessage);
    process.exit(1);
  }
}

main().catch((error) => {
  log.fatal('Fatal application error', {
    error: error instanceof Error ? error.message : String(error),
    stack: error instanceof Error ? error.stack : undefined,
  });
  console.error('Fatal error:', error);
  process.exit(1);
});
