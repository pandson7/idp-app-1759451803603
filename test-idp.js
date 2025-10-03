const fs = require('fs');
const path = require('path');

const API_BASE_URL = 'https://bi23gaqewi.execute-api.us-east-1.amazonaws.com/prod';

async function testIDPSystem() {
    console.log('Testing IDP System...');
    
    try {
        // Test 1: Get upload URL
        console.log('\n1. Testing upload endpoint...');
        const uploadResponse = await fetch(`${API_BASE_URL}/upload`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({
                fileName: 'test-image.jpg',
                fileSize: 50000,
            }),
        });
        
        console.log('Upload response status:', uploadResponse.status);
        const uploadData = await uploadResponse.text();
        console.log('Upload response:', uploadData);
        
        if (uploadResponse.ok) {
            const { documentId, uploadUrl } = JSON.parse(uploadData);
            console.log('✅ Upload endpoint working, documentId:', documentId);
            
            // Test 2: Check status endpoint
            console.log('\n2. Testing status endpoint...');
            const statusResponse = await fetch(`${API_BASE_URL}/status/${documentId}`);
            console.log('Status response status:', statusResponse.status);
            const statusData = await statusResponse.text();
            console.log('Status response:', statusData);
            
            // Test 3: Check results endpoint
            console.log('\n3. Testing results endpoint...');
            const resultsResponse = await fetch(`${API_BASE_URL}/results/${documentId}`);
            console.log('Results response status:', resultsResponse.status);
            const resultsData = await resultsResponse.text();
            console.log('Results response:', resultsData);
            
        } else {
            console.log('❌ Upload endpoint failed');
        }
        
    } catch (error) {
        console.error('Test failed:', error);
    }
}

testIDPSystem();
