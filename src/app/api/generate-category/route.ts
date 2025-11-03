import { NextRequest, NextResponse } from 'next/server';
import OpenAI from 'openai';

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

export async function POST(request: NextRequest) {
  try {
    const { title, notes } = await request.json();

    const completion = await openai.chat.completions.create({
      model: "gpt-3.5-turbo",
      messages: [{
        role: "user",
        content: `Suggest a short category name (1-2 words) for this task:
Title: ${title}
${notes ? `Notes: ${notes}` : ''}

Reply with only the category name.`
      }],
      temperature: 0.7,
      max_tokens: 20,
    });

    const category = completion.choices[0].message.content?.trim() || 'General';
    return NextResponse.json({ category });
  } catch (error: any) {
    console.error('Error:', error);
    return NextResponse.json({ error: 'Failed to generate category' }, { status: 500 });
  }
}
