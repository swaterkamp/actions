// ----------------------------------------------------------------------------
// Copyright (c) Ben Coleman, 2020
// Licensed under the MIT License.
//
// Workflow Dispatch Action - Main task code
// ----------------------------------------------------------------------------

import * as core from '@actions/core'
import {formatDuration, getArgs, isTimedOut, sleep} from './utils';
import {WorkflowHandler, WorkflowRunConclusion, WorkflowRunResult, WorkflowRunStatus} from './workflow-handler';


async function getFollowUrl(workflowHandler: WorkflowHandler, interval: number, timeout: number) {
  const start = Date.now();
  let url;
  do {
    await sleep(interval);
    try {
      const result = await workflowHandler.getWorkflowRunStatus();
      url = result.url;
    } catch (e) {
      if (typeof e === "string") {
        core.debug(`Failed to get workflow url: ${e.toUpperCase()}`);
      } else if (e instanceof Error) {
        core.debug(`Failed to get workflow url: ${e.message}`);
      }
    }
  } while (!url && !isTimedOut(start, timeout));
  return url;
}

async function waitForCompletionOrTimeout(workflowHandler: WorkflowHandler, checkStatusInterval: number, waitForCompletionTimeout: number) {
  const start = Date.now();
  let status;
  let result;
  do {
    await sleep(checkStatusInterval);
    try {
      result = await workflowHandler.getWorkflowRunStatus();
      status = result.status;
      core.debug(`Workflow is running for ${formatDuration(Date.now() - start)}. Current status=${status}`)
    } catch (e) {
      if (typeof e === "string") {
        core.warning(`Failed to get workflow status: ${e.toUpperCase()}`);
      } else if (e instanceof Error) {
        core.warning(`Failed to get workflow status: ${e.message}`);
      }
    }
  } while (status !== WorkflowRunStatus.COMPLETED && !isTimedOut(start, waitForCompletionTimeout));
  return {result, start}
}

function computeConclusion(start: number, waitForCompletionTimeout: number, result?: WorkflowRunResult) {
  if (isTimedOut(start, waitForCompletionTimeout)) {
    core.info(`Workflow wait timed out`);
    core.setOutput('workflow-conclusion', WorkflowRunConclusion.TIMED_OUT);
    throw new Error('Workflow run has failed due to timeout');
  }

  core.info(`Workflow completed with conclusion=${result?.conclusion}`);
  const conclusion = result?.conclusion;
  core.setOutput('workflow-conclusion', conclusion);

  if (conclusion === WorkflowRunConclusion.FAILURE) throw new Error('Workflow run has failed');
  if (conclusion === WorkflowRunConclusion.CANCELLED) throw new Error('Workflow run was cancelled');
  if (conclusion === WorkflowRunConclusion.TIMED_OUT) throw new Error('Workflow run has failed due to timeout');
}

//
// Main task function (async wrapper)
//
export async function trigger(): Promise<void> {
  try {
    const args = getArgs();
    const workflowHandler = new WorkflowHandler(args.token, args.workflowRef, args.owner, args.repo, args.ref);

    // Trigger workflow run
    await workflowHandler.triggerWorkflow(args.inputs);
    core.info(`Workflow triggered 🚀`);

    if (args.displayWorkflowUrl) {
      const url = await getFollowUrl(workflowHandler, args.displayWorkflowUrlInterval, args.displayWorkflowUrlTimeout)
      core.info(`You can follow the running workflow here: ${url}`);
      core.setOutput('workflow-url', url);
    }

    if (!args.waitForCompletion) {
      return;
    }

    core.info(`Waiting for workflow completion`);
    const {
      result,
      start
    } = await waitForCompletionOrTimeout(workflowHandler, args.checkStatusInterval, args.waitForCompletionTimeout);

    core.setOutput('workflow-url', result?.url);
    computeConclusion(start, args.waitForCompletionTimeout, result);

  } catch (error) {
    if (typeof error === "string") {
      core.setFailed(error.toUpperCase());
    } else if (error instanceof Error) {
      core.setFailed(error.message);
    }
    throw error
  }
}
