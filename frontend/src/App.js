import React, { useState, useRef } from 'react';
import './App.css';

// Replace with your actual API Gateway URL after deployment
const API_BASE_URL = process.env.REACT_APP_API_URL || 'https://bi23gaqewi.execute-api.us-east-1.amazonaws.com/prod';

function App() {
  const [selectedFile, setSelectedFile] = useState(null);
  const [uploading, setUploading] = useState(false);
  const [documentId, setDocumentId] = useState(null);
  const [results, setResults] = useState(null);
  const [error, setError] = useState(null);
  const [dragOver, setDragOver] = useState(false);
  const fileInputRef = useRef(null);

  const handleFileSelect = (file) => {
    if (file && (file.type.startsWith('image/') || file.type === 'application/pdf')) {
      setSelectedFile(file);
      setError(null);
    } else {
      setError('Please select an image or PDF file');
    }
  };

  const handleDrop = (e) => {
    e.preventDefault();
    setDragOver(false);
    const file = e.dataTransfer.files[0];
    handleFileSelect(file);
  };

  const handleDragOver = (e) => {
    e.preventDefault();
    setDragOver(true);
  };

  const handleDragLeave = (e) => {
    e.preventDefault();
    setDragOver(false);
  };

  const handleFileInputChange = (e) => {
    const file = e.target.files[0];
    handleFileSelect(file);
  };

  const uploadFile = async () => {
    if (!selectedFile) return;

    setUploading(true);
    setError(null);

    try {
      // Get presigned URL
      const uploadResponse = await fetch(`${API_BASE_URL}/upload`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          fileName: selectedFile.name,
          fileSize: selectedFile.size,
        }),
      });

      if (!uploadResponse.ok) {
        throw new Error('Failed to get upload URL');
      }

      const { documentId: docId, uploadUrl } = await uploadResponse.json();
      setDocumentId(docId);

      // Upload file to S3
      const s3Response = await fetch(uploadUrl, {
        method: 'PUT',
        body: selectedFile,
      });

      if (!s3Response.ok) {
        throw new Error('Failed to upload file');
      }

      // Start polling for results
      pollForResults(docId);
    } catch (err) {
      setError(err.message);
      setUploading(false);
    }
  };

  const pollForResults = async (docId) => {
    const maxAttempts = 60; // 5 minutes with 5-second intervals
    let attempts = 0;

    const poll = async () => {
      try {
        const response = await fetch(`${API_BASE_URL}/results/${docId}`);
        if (!response.ok) {
          throw new Error('Failed to fetch results');
        }

        const data = await response.json();
        setResults(data.results);

        // Check if all tasks are completed
        const tasks = ['ocr', 'classification', 'summarization'];
        const allCompleted = tasks.every(task => 
          data.results[task] && data.results[task].status === 'completed'
        );

        if (allCompleted || attempts >= maxAttempts) {
          setUploading(false);
        } else {
          attempts++;
          setTimeout(poll, 5000); // Poll every 5 seconds
        }
      } catch (err) {
        setError(err.message);
        setUploading(false);
      }
    };

    poll();
  };

  const resetForm = () => {
    setSelectedFile(null);
    setDocumentId(null);
    setResults(null);
    setError(null);
    setUploading(false);
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  };

  const renderResults = () => {
    if (!results) return null;

    return (
      <div className="results-section">
        <h2>Processing Results</h2>
        
        {/* OCR Results */}
        {results.ocr && (
          <div className="result-item">
            <h3>
              OCR Extraction 
              <span className={`status-indicator status-${results.ocr.status}`}>
                {results.ocr.status}
              </span>
            </h3>
            {results.ocr.status === 'completed' && results.ocr.results && (
              <div className="ocr-results">
                {JSON.stringify(results.ocr.results, null, 2)}
              </div>
            )}
            {results.ocr.status === 'failed' && (
              <div className="error-message">
                OCR processing failed: {results.ocr.results?.error}
              </div>
            )}
          </div>
        )}

        {/* Classification Results */}
        {results.classification && (
          <div className="result-item">
            <h3>
              Document Classification 
              <span className={`status-indicator status-${results.classification.status}`}>
                {results.classification.status}
              </span>
            </h3>
            {results.classification.status === 'completed' && results.classification.results && (
              <p><strong>Category:</strong> {results.classification.results.category}</p>
            )}
            {results.classification.status === 'failed' && (
              <div className="error-message">
                Classification failed: {results.classification.results?.error}
              </div>
            )}
          </div>
        )}

        {/* Summarization Results */}
        {results.summarization && (
          <div className="result-item">
            <h3>
              Document Summary 
              <span className={`status-indicator status-${results.summarization.status}`}>
                {results.summarization.status}
              </span>
            </h3>
            {results.summarization.status === 'completed' && results.summarization.results && (
              <p>{results.summarization.results.summary}</p>
            )}
            {results.summarization.status === 'failed' && (
              <div className="error-message">
                Summarization failed: {results.summarization.results?.error}
              </div>
            )}
          </div>
        )}

        <button onClick={resetForm} className="upload-button">
          Process Another Document
        </button>
      </div>
    );
  };

  return (
    <div className="App">
      <div className="container">
        <div className="header">
          <h1>Intelligent Document Processing</h1>
          <p>Upload a document to extract text, classify, and summarize its content</p>
        </div>

        {error && (
          <div className="error-message">
            {error}
          </div>
        )}

        {!documentId && (
          <div className="upload-section">
            <div 
              className={`upload-area ${dragOver ? 'dragover' : ''}`}
              onDrop={handleDrop}
              onDragOver={handleDragOver}
              onDragLeave={handleDragLeave}
              onClick={() => fileInputRef.current?.click()}
            >
              <input
                ref={fileInputRef}
                type="file"
                className="file-input"
                accept="image/*,application/pdf"
                onChange={handleFileInputChange}
              />
              
              {selectedFile ? (
                <div>
                  <p><strong>Selected:</strong> {selectedFile.name}</p>
                  <p>Size: {(selectedFile.size / 1024 / 1024).toFixed(2)} MB</p>
                  <button 
                    onClick={(e) => {
                      e.stopPropagation();
                      uploadFile();
                    }}
                    disabled={uploading}
                    className="upload-button"
                  >
                    {uploading ? 'Processing...' : 'Upload and Process'}
                  </button>
                </div>
              ) : (
                <div>
                  <p>Drag and drop a document here, or click to select</p>
                  <p>Supported formats: Images (JPG, PNG, etc.) and PDF</p>
                </div>
              )}
            </div>
          </div>
        )}

        {uploading && (
          <div className="loading">
            <p>Processing document... This may take a few minutes.</p>
            <p>Document ID: {documentId}</p>
          </div>
        )}

        {renderResults()}
      </div>
    </div>
  );
}

export default App;
