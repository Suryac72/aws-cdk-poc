import { CodePipeline } from 'aws-sdk';
import { Handler } from 'aws-lambda';

// Initialize CodePipeline client
const codePipeline = new CodePipeline();

interface LambdaEvent {
  pipelineName: string;
  approvalToken: string; 
  stageName: string;
  actionName: string;
}

export const handler: Handler<LambdaEvent> = async (event) => {
  const { pipelineName, stageName, actionName } = event;
 
  try {
    const pipelineState = await codePipeline.getPipelineState({ name: pipelineName }).promise();

    if (!pipelineState.stageStates) {
      throw new Error('No stage states found for the pipeline.');
    }

    // Find the specific stage
    const stage = pipelineState.stageStates.find(stage => stage.stageName === stageName);

    if (!stage || !stage.actionStates) {
      throw new Error(`Stage '${stageName}' not found or no action states available.`);
    }

    // Find the specific action within the stage
    const action = stage.actionStates.find(actionState => actionState.actionName === actionName);

    if (!action || !action.latestExecution || !action.latestExecution.token) {
      throw new Error(`Action '${actionName}' not found or no approval token available.`);
    }

    const approvalToken = action.latestExecution.token;

    const approvalParams = {
      pipelineName,
      stageName,
      actionName,
      result: {
        status: 'Approved', // 'Approved' or 'Rejected'
        summary: 'Stage approved by Lambda function',
      },
      token: approvalToken,
    };

    console.log("Approval Params:", approvalParams);
    
    // Submit the approval result
    const response = await codePipeline.putApprovalResult(approvalParams).promise();
    console.log('Approval result submitted:', response);

    return { message: 'Stage approval submitted successfully.' };
  } catch (error) {
    console.error('Error submitting approval result:', error);
    throw error;
  }
};
