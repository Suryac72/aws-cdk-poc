import * as cdk from 'aws-cdk-lib';
import { Construct } from 'constructs';
import { Pipeline, Artifact } from 'aws-cdk-lib/aws-codepipeline';
import { GitHubSourceAction, CodeBuildAction, ManualApprovalAction } from 'aws-cdk-lib/aws-codepipeline-actions';
import { Project, BuildSpec } from 'aws-cdk-lib/aws-codebuild';
import { Effect, Policy, PolicyDocument, PolicyStatement, Role, ServicePrincipal } from 'aws-cdk-lib/aws-iam';
import { NodejsFunction } from 'aws-cdk-lib/aws-lambda-nodejs';
import { Runtime } from 'aws-cdk-lib/aws-lambda';
import { CfnResource, Duration } from 'aws-cdk-lib';

export class CdkPocStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    // GitHub repository details
    const githubRepoOwner = 'Suryac72';
    const githubRepoName = 'timebox-deployment-cdk-poc';
    const githubBranch = 'master';
    const githubOAuthToken = cdk.SecretValue.secretsManager('github-token');

    // Create a pipeline
    const pipeline = new Pipeline(this, 'TimeBoxCodePipeline', {
      pipelineName: 'TimeBoxCodePipeline',
    });

    // Artifacts
    const sourceOutput = new Artifact();
    const devBuildOutput = new Artifact();

    // Define the source action
    const sourceAction = new GitHubSourceAction({
      actionName: 'GitHub_Source',
      owner: githubRepoOwner,
      repo: githubRepoName,
      oauthToken: githubOAuthToken,
      output: sourceOutput,
      branch: githubBranch,
    });

    // Add source stage
    pipeline.addStage({
      stageName: 'Source',
      actions: [sourceAction],
    });

    // Define the DEV stage
    const devProject = new Project(this, 'DevBuildStageProject', {
      buildSpec: BuildSpec.fromObject({
        version: '0.2',
        phases: {
          install: {
            runtimeVersions: {
              nodejs: 18,
            },
            commands: ['npm install'],
          },
        },
        artifacts: {
          files: '**/*',
        },
      }),
    });

    const devAction = new CodeBuildAction({
      actionName: 'Dev_Stage_Build',
      project: devProject,
      input: sourceOutput,
      outputs: [devBuildOutput],
    });

    // Add DEV stage
    pipeline.addStage({
      stageName: 'DEV',
      actions: [devAction],
    });

    // Define the QA stage
    const qaProject = new Project(this, 'QaBuildStageProject', {
      buildSpec: BuildSpec.fromObject({
        version: '0.2',
        phases: {
          install: {
            runtimeVersions: {
              nodejs: 18,
            },
            commands: ['npm install'],
          },
        },
        artifacts: {
          files: '**/*',
        },
      }),
    });

    const qaAction = new CodeBuildAction({
      actionName: 'QA_Stage_Test',
      project: qaProject,
      input: sourceOutput,
      runOrder: 2, // Ensures QA stage doesn't run immediately after DEV
    });

    const manualApprovalAction = new ManualApprovalAction({
      actionName: 'Approve_QA',
    });
    
    pipeline.addStage({
      stageName: 'Pre_QA_Approval',
      actions: [manualApprovalAction],
    });
    

    // Add QA stage to pipeline (but set it to not auto-trigger)
    pipeline.addStage({
      stageName: 'QA',
      actions: [qaAction],
    });

     // Create IAM Role for Lambda
     const lambdaRole = new Role(this, 'LambdaExecutionRole', {
      assumedBy: new ServicePrincipal('lambda.amazonaws.com'),
    });

    lambdaRole.addManagedPolicy({
      managedPolicyArn: 'arn:aws:iam::aws:policy/service-role/AWSLambdaBasicExecutionRole',
    });

    lambdaRole.addToPolicy(new PolicyStatement({
      actions: ['codepipeline:PutApprovalResult'],
      resources: [pipeline.pipelineArn],
      effect: Effect.ALLOW,
    }));

    // Lambda to trigger the QA stage
    const oneOffLambda = new NodejsFunction(this, 'OneOffLambda', {
      entry: 'lib/lambda/qa-stage-trigger.ts', // Lambda code should be in this file
      handler: 'index.handler',
      runtime: Runtime.NODEJS_20_X,
      timeout: Duration.seconds(10),
      environment: {
        PIPELINE_NAME: pipeline.pipelineName,
      },
    });

    // IAM Role for AWS Scheduler to invoke the Lambda
    const schedulerRole = new Role(this, 'schedulerRole', {
      assumedBy: new ServicePrincipal('scheduler.amazonaws.com'),
    });

    // Policy to allow Scheduler to invoke the Lambda
    const invokeLambdaPolicy = new Policy(this, 'invokeLambdaPolicy', {
      document: new PolicyDocument({
        statements: [
          new PolicyStatement({
            actions: ['lambda:InvokeFunction'],
            resources: [oneOffLambda.functionArn],
            effect: Effect.ALLOW,
          }),
        ],
      }),
    });

    schedulerRole.attachInlinePolicy(invokeLambdaPolicy);

    // AWS Scheduler rule to run at 9:00 PM IST (3:30 PM UTC)
    new CfnResource(this, 'oneOffSchedule', {
      type: 'AWS::Scheduler::Schedule',
      properties: {
        Name: 'oneOffSchedule',
        Description: 'Runs a schedule every day at 10:10 PM IST',
        FlexibleTimeWindow: { Mode: 'OFF' },
        ScheduleExpression: 'cron(15 17 * * ? *)', // 10:10 PM IST (4:40 PM UTC)
        Target: {
          Arn: oneOffLambda.functionArn,
          RoleArn: schedulerRole.roleArn,
          Input: JSON.stringify({
            pipelineName: 'TimeBoxCodePipeline',
            approvalToken: 'your-approval-token',
            stageName: 'Pre_QA_Approval',
            actionName: 'Approve_QA'
          }),
        },
      },
    });
    
  }
}
