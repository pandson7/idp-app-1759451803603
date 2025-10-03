# Design Document

## Architecture Overview

The IDP application follows a serverless architecture using AWS services with a React frontend. The system processes documents through a sequential pipeline triggered by S3 events.

## System Components

### Frontend Layer
- **React Application**: Simple, professional UI hosted on S3 with CloudFront
- **Upload Interface**: File upload component with drag-and-drop functionality
- **Results Display**: Clean presentation of OCR, classification, and summarization results

### Storage Layer
- **S3 Bucket**: Document storage with event notifications
- **DynamoDB Table**: Flexible schema for storing processing results with GSI for efficient queries

### Processing Layer
- **Lambda Functions**: 
  - OCR Processor: Uses Amazon Bedrock Claude Sonnet for text extraction
  - Document Classifier: Uses Amazon Bedrock Claude Sonnet for categorization
  - Document Summarizer: Uses Amazon Bedrock Claude Sonnet for summary generation
- **Step Functions**: Orchestrates the sequential processing pipeline

### API Layer
- **API Gateway**: RESTful endpoints for frontend communication
- **Lambda Functions**: API handlers for upload, status, and results retrieval

## Data Flow

```
1. User uploads document → S3 Bucket
2. S3 Event → Step Functions execution
3. Step Functions → OCR Lambda → Bedrock Claude Sonnet
4. OCR Results → DynamoDB
5. Step Functions → Classification Lambda → Bedrock Claude Sonnet  
6. Classification Results → DynamoDB
7. Step Functions → Summarization Lambda → Bedrock Claude Sonnet
8. Summarization Results → DynamoDB
9. Frontend polls API → Results displayed
```

## Security Considerations

- IAM roles with least privilege access
- S3 bucket policies for secure document storage
- API Gateway with CORS configuration
- Bedrock model access through inference profiles

## Technology Stack

- **Frontend**: React (no Tailwind), hosted on S3/CloudFront
- **Backend**: AWS Lambda (Node.js)
- **Database**: DynamoDB with provisioned billing
- **AI/ML**: Amazon Bedrock Claude Sonnet 4
- **Infrastructure**: AWS CDK
- **Storage**: Amazon S3

## Database Schema

### DynamoDB Table: ProcessingResults
```
Primary Key: documentId (String)
Sort Key: taskType (String) - values: "upload", "ocr", "classification", "summarization"

Attributes:
- documentId: Unique identifier for the document
- taskType: Type of processing task
- status: "pending", "processing", "completed", "failed"
- results: JSON object containing task-specific results
- timestamp: Processing timestamp
- fileName: Original file name
- fileSize: File size in bytes
- s3Key: S3 object key
```

## API Endpoints

- `POST /upload` - Generate presigned URL for document upload
- `GET /status/{documentId}` - Get processing status
- `GET /results/{documentId}` - Get all processing results
- `GET /documents` - List processed documents

## Processing Pipeline Details

### OCR Processing
- Input: Document from S3
- Process: Extract text using Bedrock Claude Sonnet with structured prompt
- Output: JSON with key-value pairs stored in DynamoDB

### Document Classification  
- Input: OCR results from DynamoDB
- Process: Classify using Bedrock Claude Sonnet against predefined categories
- Output: Category assignment stored in DynamoDB

### Document Summarization
- Input: OCR results from DynamoDB
- Process: Generate summary using Bedrock Claude Sonnet
- Output: Summary text stored in DynamoDB

## Error Handling

- Retry logic for transient failures
- Dead letter queues for failed processing
- Graceful error messages in UI
- Comprehensive logging with CloudWatch
