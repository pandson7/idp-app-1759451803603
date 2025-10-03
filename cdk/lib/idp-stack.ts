import * as cdk from 'aws-cdk-lib';
import * as s3 from 'aws-cdk-lib/aws-s3';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb';
import * as apigateway from 'aws-cdk-lib/aws-apigateway';
import * as stepfunctions from 'aws-cdk-lib/aws-stepfunctions';
import * as sfnTasks from 'aws-cdk-lib/aws-stepfunctions-tasks';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as s3n from 'aws-cdk-lib/aws-s3-notifications';
import * as cloudfront from 'aws-cdk-lib/aws-cloudfront';
import * as origins from 'aws-cdk-lib/aws-cloudfront-origins';
import { Construct } from 'constructs';

export class IdpStack1759451803603 extends cdk.Stack {
  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    const suffix = '1759451803603';

    // DynamoDB table for storing processing results
    const processingTable = new dynamodb.Table(this, `ProcessingResults${suffix}`, {
      tableName: `processing-results-${suffix}`,
      partitionKey: { name: 'documentId', type: dynamodb.AttributeType.STRING },
      sortKey: { name: 'taskType', type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PROVISIONED,
      readCapacity: 5,
      writeCapacity: 5,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
    });

    // S3 bucket for document storage
    const documentBucket = new s3.Bucket(this, `DocumentBucket${suffix}`, {
      bucketName: `idp-documents-${suffix}`,
      cors: [{
        allowedMethods: [s3.HttpMethods.GET, s3.HttpMethods.POST, s3.HttpMethods.PUT],
        allowedOrigins: ['*'],
        allowedHeaders: ['*'],
      }],
      removalPolicy: cdk.RemovalPolicy.DESTROY,
      autoDeleteObjects: true,
    });

    // S3 bucket for frontend hosting
    const frontendBucket = new s3.Bucket(this, `FrontendBucket${suffix}`, {
      bucketName: `idp-frontend-${suffix}`,
      websiteIndexDocument: 'index.html',
      websiteErrorDocument: 'error.html',
      publicReadAccess: true,
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ACLS,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
      autoDeleteObjects: true,
    });

    // CloudFront distribution for frontend
    const distribution = new cloudfront.Distribution(this, `FrontendDistribution${suffix}`, {
      defaultBehavior: {
        origin: new origins.S3Origin(frontendBucket),
        viewerProtocolPolicy: cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
      },
    });

    // IAM role for Lambda functions with Bedrock access
    const lambdaRole = new iam.Role(this, `LambdaRole${suffix}`, {
      assumedBy: new iam.ServicePrincipal('lambda.amazonaws.com'),
      managedPolicies: [
        iam.ManagedPolicy.fromAwsManagedPolicyName('service-role/AWSLambdaBasicExecutionRole'),
      ],
      inlinePolicies: {
        BedrockAccess: new iam.PolicyDocument({
          statements: [
            new iam.PolicyStatement({
              effect: iam.Effect.ALLOW,
              actions: [
                'bedrock:InvokeModel',
                'bedrock:InvokeModelWithResponseStream',
              ],
              resources: [
                'arn:aws:bedrock:*:*:inference-profile/global.anthropic.claude-sonnet-4-20250514-v1:0',
                'arn:aws:bedrock:*::foundation-model/anthropic.claude-sonnet-4-20250514-v1:0',
              ],
            }),
          ],
        }),
        DynamoDBAccess: new iam.PolicyDocument({
          statements: [
            new iam.PolicyStatement({
              effect: iam.Effect.ALLOW,
              actions: [
                'dynamodb:PutItem',
                'dynamodb:GetItem',
                'dynamodb:UpdateItem',
                'dynamodb:Query',
                'dynamodb:Scan',
              ],
              resources: [processingTable.tableArn],
            }),
          ],
        }),
        S3Access: new iam.PolicyDocument({
          statements: [
            new iam.PolicyStatement({
              effect: iam.Effect.ALLOW,
              actions: [
                's3:GetObject',
                's3:PutObject',
                's3:DeleteObject',
              ],
              resources: [documentBucket.arnForObjects('*')],
            }),
          ],
        }),
      },
    });

    // Lambda functions
    const ocrLambda = new lambda.Function(this, `OCRProcessor${suffix}`, {
      functionName: `ocr-processor-${suffix}`,
      runtime: lambda.Runtime.NODEJS_18_X,
      handler: 'index.handler',
      role: lambdaRole,
      code: lambda.Code.fromInline(`
        const { BedrockRuntimeClient, InvokeModelCommand } = require('@aws-sdk/client-bedrock-runtime');
        const { DynamoDBClient, PutItemCommand } = require('@aws-sdk/client-dynamodb');
        const { S3Client, GetObjectCommand } = require('@aws-sdk/client-s3');

        const bedrock = new BedrockRuntimeClient({ region: process.env.AWS_REGION });
        const dynamodb = new DynamoDBClient({ region: process.env.AWS_REGION });
        const s3 = new S3Client({ region: process.env.AWS_REGION });

        exports.handler = async (event) => {
          try {
            const { documentId, s3Key } = event;
            
            // Get document from S3
            const getObjectCommand = new GetObjectCommand({
              Bucket: process.env.DOCUMENT_BUCKET,
              Key: s3Key,
            });
            
            const response = await s3.send(getObjectCommand);
            const documentContent = await response.Body.transformToString('base64');
            
            // Process with Bedrock
            const prompt = 'Extract key-value pairs from this document image. Return only valid JSON format with key-value pairs. Handle any markdown-wrapped JSON correctly. Image data: ' + documentContent;

            const invokeCommand = new InvokeModelCommand({
              modelId: 'global.anthropic.claude-sonnet-4-20250514-v1:0',
              body: JSON.stringify({
                anthropic_version: 'bedrock-2023-05-31',
                max_tokens: 4000,
                messages: [{
                  role: 'user',
                  content: [{ type: 'text', text: prompt }]
                }]
              }),
            });

            const bedrockResponse = await bedrock.send(invokeCommand);
            const responseBody = JSON.parse(new TextDecoder().decode(bedrockResponse.body));
            
            let ocrResults;
            try {
              const content = responseBody.content[0].text;
              // Handle markdown-wrapped JSON
              const jsonMatch = content.match(/\`\`\`json\\n([\\s\\S]*?)\\n\`\`\`/) || content.match(/\`\`\`\\n([\\s\\S]*?)\\n\`\`\`/);
              if (jsonMatch) {
                ocrResults = JSON.parse(jsonMatch[1]);
              } else {
                ocrResults = JSON.parse(content);
              }
            } catch (parseError) {
              ocrResults = { error: 'Failed to parse OCR results', raw: responseBody.content[0].text };
            }

            // Store results in DynamoDB
            await dynamodb.send(new PutItemCommand({
              TableName: process.env.PROCESSING_TABLE,
              Item: {
                documentId: { S: documentId },
                taskType: { S: 'ocr' },
                status: { S: 'completed' },
                results: { S: JSON.stringify(ocrResults) },
                timestamp: { S: new Date().toISOString() },
              },
            }));

            return { statusCode: 200, body: JSON.stringify({ documentId, ocrResults }) };
          } catch (error) {
            console.error('OCR processing error:', error);
            
            await dynamodb.send(new PutItemCommand({
              TableName: process.env.PROCESSING_TABLE,
              Item: {
                documentId: { S: event.documentId },
                taskType: { S: 'ocr' },
                status: { S: 'failed' },
                results: { S: JSON.stringify({ error: error.message }) },
                timestamp: { S: new Date().toISOString() },
              },
            }));
            
            throw error;
          }
        };
      `),
      environment: {
        PROCESSING_TABLE: processingTable.tableName,
        DOCUMENT_BUCKET: documentBucket.bucketName,
      },
      timeout: cdk.Duration.minutes(5),
    });

    const classifierLambda = new lambda.Function(this, `DocumentClassifier${suffix}`, {
      functionName: `document-classifier-${suffix}`,
      runtime: lambda.Runtime.NODEJS_18_X,
      handler: 'index.handler',
      role: lambdaRole,
      code: lambda.Code.fromInline(`
        const { BedrockRuntimeClient, InvokeModelCommand } = require('@aws-sdk/client-bedrock-runtime');
        const { DynamoDBClient, PutItemCommand, GetItemCommand } = require('@aws-sdk/client-dynamodb');

        const bedrock = new BedrockRuntimeClient({ region: process.env.AWS_REGION });
        const dynamodb = new DynamoDBClient({ region: process.env.AWS_REGION });

        exports.handler = async (event) => {
          try {
            const { documentId } = event;
            
            // Get OCR results from DynamoDB
            const getItemResponse = await dynamodb.send(new GetItemCommand({
              TableName: process.env.PROCESSING_TABLE,
              Key: {
                documentId: { S: documentId },
                taskType: { S: 'ocr' },
              },
            }));

            if (!getItemResponse.Item) {
              throw new Error('OCR results not found');
            }

            const ocrResults = JSON.parse(getItemResponse.Item.results.S);
            
            // Classify document using Bedrock
            const prompt = 'Classify this document into one of these categories: Dietary Supplement, Stationery, Kitchen Supplies, Medicine, Other. Document content: ' + JSON.stringify(ocrResults) + ' Return only the category name.';

            const invokeCommand = new InvokeModelCommand({
              modelId: 'global.anthropic.claude-sonnet-4-20250514-v1:0',
              body: JSON.stringify({
                anthropic_version: 'bedrock-2023-05-31',
                max_tokens: 100,
                messages: [{
                  role: 'user',
                  content: [{ type: 'text', text: prompt }]
                }]
              }),
            });

            const bedrockResponse = await bedrock.send(invokeCommand);
            const responseBody = JSON.parse(new TextDecoder().decode(bedrockResponse.body));
            const category = responseBody.content[0].text.trim();

            // Store results in DynamoDB
            await dynamodb.send(new PutItemCommand({
              TableName: process.env.PROCESSING_TABLE,
              Item: {
                documentId: { S: documentId },
                taskType: { S: 'classification' },
                status: { S: 'completed' },
                results: { S: JSON.stringify({ category }) },
                timestamp: { S: new Date().toISOString() },
              },
            }));

            return { statusCode: 200, body: JSON.stringify({ documentId, category }) };
          } catch (error) {
            console.error('Classification error:', error);
            
            await dynamodb.send(new PutItemCommand({
              TableName: process.env.PROCESSING_TABLE,
              Item: {
                documentId: { S: event.documentId },
                taskType: { S: 'classification' },
                status: { S: 'failed' },
                results: { S: JSON.stringify({ error: error.message }) },
                timestamp: { S: new Date().toISOString() },
              },
            }));
            
            throw error;
          }
        };
      `),
      environment: {
        PROCESSING_TABLE: processingTable.tableName,
      },
      timeout: cdk.Duration.minutes(2),
    });

    const summarizerLambda = new lambda.Function(this, `DocumentSummarizer${suffix}`, {
      functionName: `document-summarizer-${suffix}`,
      runtime: lambda.Runtime.NODEJS_18_X,
      handler: 'index.handler',
      role: lambdaRole,
      code: lambda.Code.fromInline(`
        const { BedrockRuntimeClient, InvokeModelCommand } = require('@aws-sdk/client-bedrock-runtime');
        const { DynamoDBClient, PutItemCommand, GetItemCommand } = require('@aws-sdk/client-dynamodb');

        const bedrock = new BedrockRuntimeClient({ region: process.env.AWS_REGION });
        const dynamodb = new DynamoDBClient({ region: process.env.AWS_REGION });

        exports.handler = async (event) => {
          try {
            const { documentId } = event;
            
            // Get OCR results from DynamoDB
            const getItemResponse = await dynamodb.send(new GetItemCommand({
              TableName: process.env.PROCESSING_TABLE,
              Key: {
                documentId: { S: documentId },
                taskType: { S: 'ocr' },
              },
            }));

            if (!getItemResponse.Item) {
              throw new Error('OCR results not found');
            }

            const ocrResults = JSON.parse(getItemResponse.Item.results.S);
            
            // Generate summary using Bedrock
            const prompt = 'Generate a concise summary of this document based on the extracted content: ' + JSON.stringify(ocrResults) + ' Provide a clear, informative summary in 2-3 sentences.';

            const invokeCommand = new InvokeModelCommand({
              modelId: 'global.anthropic.claude-sonnet-4-20250514-v1:0',
              body: JSON.stringify({
                anthropic_version: 'bedrock-2023-05-31',
                max_tokens: 500,
                messages: [{
                  role: 'user',
                  content: [{ type: 'text', text: prompt }]
                }]
              }),
            });

            const bedrockResponse = await bedrock.send(invokeCommand);
            const responseBody = JSON.parse(new TextDecoder().decode(bedrockResponse.body));
            const summary = responseBody.content[0].text.trim();

            // Store results in DynamoDB
            await dynamodb.send(new PutItemCommand({
              TableName: process.env.PROCESSING_TABLE,
              Item: {
                documentId: { S: documentId },
                taskType: { S: 'summarization' },
                status: { S: 'completed' },
                results: { S: JSON.stringify({ summary }) },
                timestamp: { S: new Date().toISOString() },
              },
            }));

            return { statusCode: 200, body: JSON.stringify({ documentId, summary }) };
          } catch (error) {
            console.error('Summarization error:', error);
            
            await dynamodb.send(new PutItemCommand({
              TableName: process.env.PROCESSING_TABLE,
              Item: {
                documentId: { S: event.documentId },
                taskType: { S: 'summarization' },
                status: { S: 'failed' },
                results: { S: JSON.stringify({ error: error.message }) },
                timestamp: { S: new Date().toISOString() },
              },
            }));
            
            throw error;
          }
        };
      `),
      environment: {
        PROCESSING_TABLE: processingTable.tableName,
      },
      timeout: cdk.Duration.minutes(2),
    });

    // Step Functions state machine
    const ocrTask = new sfnTasks.LambdaInvoke(this, `OCRTask${suffix}`, {
      lambdaFunction: ocrLambda,
      outputPath: '$.Payload',
    });

    const classificationTask = new sfnTasks.LambdaInvoke(this, `ClassificationTask${suffix}`, {
      lambdaFunction: classifierLambda,
      outputPath: '$.Payload',
    });

    const summarizationTask = new sfnTasks.LambdaInvoke(this, `SummarizationTask${suffix}`, {
      lambdaFunction: summarizerLambda,
      outputPath: '$.Payload',
    });

    const definition = ocrTask
      .next(classificationTask)
      .next(summarizationTask);

    const stateMachine = new stepfunctions.StateMachine(this, `ProcessingPipeline${suffix}`, {
      stateMachineName: `idp-pipeline-${suffix}`,
      definition,
      timeout: cdk.Duration.minutes(15),
    });

    // API Gateway Lambda functions
    const uploadHandler = new lambda.Function(this, `UploadHandler${suffix}`, {
      functionName: `upload-handler-${suffix}`,
      runtime: lambda.Runtime.NODEJS_18_X,
      handler: 'index.handler',
      role: lambdaRole,
      code: lambda.Code.fromInline(`
        const { S3Client, PutObjectCommand } = require('@aws-sdk/client-s3');
        const { getSignedUrl } = require('@aws-sdk/s3-request-presigner');
        const { DynamoDBClient, PutItemCommand } = require('@aws-sdk/client-dynamodb');
        const { SFNClient, StartExecutionCommand } = require('@aws-sdk/client-sfn');
        const { v4: uuidv4 } = require('uuid');

        const s3 = new S3Client({ region: process.env.AWS_REGION });
        const dynamodb = new DynamoDBClient({ region: process.env.AWS_REGION });
        const sfn = new SFNClient({ region: process.env.AWS_REGION });

        exports.handler = async (event) => {
          try {
            const { fileName, fileSize } = JSON.parse(event.body);
            const documentId = uuidv4();
            const s3Key = 'documents/' + documentId + '/' + fileName;

            // Generate presigned URL
            const command = new PutObjectCommand({
              Bucket: process.env.DOCUMENT_BUCKET,
              Key: s3Key,
            });
            
            const uploadUrl = await getSignedUrl(s3, command, { expiresIn: 3600 });

            // Store upload record
            await dynamodb.send(new PutItemCommand({
              TableName: process.env.PROCESSING_TABLE,
              Item: {
                documentId: { S: documentId },
                taskType: { S: 'upload' },
                status: { S: 'pending' },
                results: { S: JSON.stringify({ fileName, fileSize, s3Key }) },
                timestamp: { S: new Date().toISOString() },
              },
            }));

            // Start Step Functions execution
            await sfn.send(new StartExecutionCommand({
              stateMachineArn: process.env.STATE_MACHINE_ARN,
              name: 'execution-' + documentId,
              input: JSON.stringify({ documentId, s3Key }),
            }));

            return {
              statusCode: 200,
              headers: {
                'Access-Control-Allow-Origin': '*',
                'Access-Control-Allow-Headers': 'Content-Type',
                'Access-Control-Allow-Methods': 'OPTIONS,POST,GET',
              },
              body: JSON.stringify({ documentId, uploadUrl }),
            };
          } catch (error) {
            console.error('Upload handler error:', error);
            return {
              statusCode: 500,
              headers: {
                'Access-Control-Allow-Origin': '*',
              },
              body: JSON.stringify({ error: error.message }),
            };
          }
        };
      `),
      environment: {
        PROCESSING_TABLE: processingTable.tableName,
        DOCUMENT_BUCKET: documentBucket.bucketName,
        STATE_MACHINE_ARN: stateMachine.stateMachineArn,
      },
    });

    const statusHandler = new lambda.Function(this, `StatusHandler${suffix}`, {
      functionName: `status-handler-${suffix}`,
      runtime: lambda.Runtime.NODEJS_18_X,
      handler: 'index.handler',
      role: lambdaRole,
      code: lambda.Code.fromInline(`
        const { DynamoDBClient, QueryCommand } = require('@aws-sdk/client-dynamodb');

        const dynamodb = new DynamoDBClient({ region: process.env.AWS_REGION });

        exports.handler = async (event) => {
          try {
            const documentId = event.pathParameters.documentId;

            const queryResponse = await dynamodb.send(new QueryCommand({
              TableName: process.env.PROCESSING_TABLE,
              KeyConditionExpression: 'documentId = :documentId',
              ExpressionAttributeValues: {
                ':documentId': { S: documentId },
              },
            }));

            const tasks = queryResponse.Items.map(item => ({
              taskType: item.taskType.S,
              status: item.status.S,
              timestamp: item.timestamp.S,
            }));

            return {
              statusCode: 200,
              headers: {
                'Access-Control-Allow-Origin': '*',
              },
              body: JSON.stringify({ documentId, tasks }),
            };
          } catch (error) {
            console.error('Status handler error:', error);
            return {
              statusCode: 500,
              headers: {
                'Access-Control-Allow-Origin': '*',
              },
              body: JSON.stringify({ error: error.message }),
            };
          }
        };
      `),
      environment: {
        PROCESSING_TABLE: processingTable.tableName,
      },
    });

    const resultsHandler = new lambda.Function(this, `ResultsHandler${suffix}`, {
      functionName: `results-handler-${suffix}`,
      runtime: lambda.Runtime.NODEJS_18_X,
      handler: 'index.handler',
      role: lambdaRole,
      code: lambda.Code.fromInline(`
        const { DynamoDBClient, QueryCommand } = require('@aws-sdk/client-dynamodb');

        const dynamodb = new DynamoDBClient({ region: process.env.AWS_REGION });

        exports.handler = async (event) => {
          try {
            const documentId = event.pathParameters.documentId;

            const queryResponse = await dynamodb.send(new QueryCommand({
              TableName: process.env.PROCESSING_TABLE,
              KeyConditionExpression: 'documentId = :documentId',
              ExpressionAttributeValues: {
                ':documentId': { S: documentId },
              },
            }));

            const results = {};
            queryResponse.Items.forEach(item => {
              const taskType = item.taskType.S;
              const status = item.status.S;
              const taskResults = JSON.parse(item.results.S);
              
              results[taskType] = {
                status,
                results: taskResults,
                timestamp: item.timestamp.S,
              };
            });

            return {
              statusCode: 200,
              headers: {
                'Access-Control-Allow-Origin': '*',
              },
              body: JSON.stringify({ documentId, results }),
            };
          } catch (error) {
            console.error('Results handler error:', error);
            return {
              statusCode: 500,
              headers: {
                'Access-Control-Allow-Origin': '*',
              },
              body: JSON.stringify({ error: error.message }),
            };
          }
        };
      `),
      environment: {
        PROCESSING_TABLE: processingTable.tableName,
      },
    });

    // Grant Step Functions permission to invoke Lambda functions
    stateMachine.grantStartExecution(uploadHandler);

    // API Gateway
    const api = new apigateway.RestApi(this, `IdpApi${suffix}`, {
      restApiName: `idp-api-${suffix}`,
      defaultCorsPreflightOptions: {
        allowOrigins: apigateway.Cors.ALL_ORIGINS,
        allowMethods: apigateway.Cors.ALL_METHODS,
        allowHeaders: ['Content-Type', 'X-Amz-Date', 'Authorization', 'X-Api-Key'],
      },
    });

    const uploadResource = api.root.addResource('upload');
    uploadResource.addMethod('POST', new apigateway.LambdaIntegration(uploadHandler));

    const statusResource = api.root.addResource('status');
    const statusDocumentResource = statusResource.addResource('{documentId}');
    statusDocumentResource.addMethod('GET', new apigateway.LambdaIntegration(statusHandler));

    const resultsResource = api.root.addResource('results');
    const resultsDocumentResource = resultsResource.addResource('{documentId}');
    resultsDocumentResource.addMethod('GET', new apigateway.LambdaIntegration(resultsHandler));

    // Outputs
    new cdk.CfnOutput(this, 'ApiUrl', {
      value: api.url,
      description: 'API Gateway URL',
    });

    new cdk.CfnOutput(this, 'FrontendUrl', {
      value: `https://${distribution.distributionDomainName}`,
      description: 'Frontend URL',
    });

    new cdk.CfnOutput(this, 'DocumentBucketName', {
      value: documentBucket.bucketName,
      description: 'Document storage bucket name',
    });

    new cdk.CfnOutput(this, 'FrontendBucketName', {
      value: frontendBucket.bucketName,
      description: 'Frontend hosting bucket name',
    });
  }
}
