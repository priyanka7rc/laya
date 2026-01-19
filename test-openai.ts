// Simple OpenAI API Connection Test
// Run with: npx tsx test-openai.ts

import OpenAI from 'openai';
import { readFileSync } from 'fs';
import { join } from 'path';

// Manually load .env.local
try {
  const envPath = join(process.cwd(), '.env.local');
  const envContent = readFileSync(envPath, 'utf-8');
  envContent.split('\n').forEach(line => {
    const trimmed = line.trim();
    if (trimmed && !trimmed.startsWith('#')) {
      const [key, ...valueParts] = trimmed.split('=');
      const value = valueParts.join('=');
      if (key && value) {
        process.env[key.trim()] = value.trim();
      }
    }
  });
} catch (err) {
  console.error('Warning: Could not load .env.local');
}

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

async function testConnection() {
  console.log('🔍 Testing OpenAI API connection...\n');
  
  // Check if API key is set
  if (!process.env.OPENAI_API_KEY) {
    console.error('❌ OPENAI_API_KEY not found in .env.local');
    console.log('   Add your API key to .env.local:');
    console.log('   OPENAI_API_KEY=sk-proj-xxxxxxxxxxxxx\n');
    process.exit(1);
  }

  console.log('✓ API key found:', process.env.OPENAI_API_KEY.substring(0, 20) + '...\n');

  try {
    const startTime = Date.now();
    
    const response = await openai.chat.completions.create({
      model: process.env.OPENAI_MODEL || 'gpt-4o-mini',
      messages: [
        { 
          role: 'user', 
          content: 'Say "Hello from OpenAI!" and nothing else.' 
        }
      ],
      max_tokens: 20,
    });
    
    const duration = Date.now() - startTime;
    
    console.log('✅ OpenAI connection successful!\n');
    console.log('📊 Details:');
    console.log('   Model:', response.model);
    console.log('   Response:', response.choices[0].message.content);
    console.log('   Tokens used:', response.usage?.total_tokens || 'N/A');
    console.log('   Duration:', duration + 'ms');
    console.log('   Estimated cost: $' + ((response.usage?.total_tokens || 0) * 0.00000015).toFixed(6));
    console.log('\n✨ Your OpenAI API is ready for Relish!\n');
    
  } catch (error: any) {
    console.error('❌ OpenAI API error:\n');
    
    if (error.status === 429) {
      console.error('   Error: Insufficient quota or rate limit exceeded');
      console.error('   Code:', error.code);
      console.error('\n   Solutions:');
      console.error('   1. Add billing: https://platform.openai.com/account/billing');
      console.error('   2. Check usage limits: https://platform.openai.com/usage');
      console.error('   3. Wait a few minutes and try again\n');
    } else if (error.status === 401) {
      console.error('   Error: Unauthorized - Invalid API key');
      console.error('\n   Solutions:');
      console.error('   1. Check your API key is correct');
      console.error('   2. Generate new key: https://platform.openai.com/api-keys');
      console.error('   3. Update .env.local with new key\n');
    } else {
      console.error('   Status:', error.status || 'N/A');
      console.error('   Message:', error.message);
      console.error('   Full error:', JSON.stringify(error, null, 2));
    }
    
    process.exit(1);
  }
}

testConnection();

