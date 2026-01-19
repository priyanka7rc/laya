import { NextRequest, NextResponse } from 'next/server';
import { regenerateGroceryList } from '@/lib/groceryListGenerator';

export async function POST(request: NextRequest) {
  try {
    const { userId, weekStartDate } = await request.json();

    if (!userId || !weekStartDate) {
      return NextResponse.json(
        { error: 'userId and weekStartDate required' },
        { status: 400 }
      );
    }

    console.log(`🔄 Regenerating grocery list for user ${userId}, week ${weekStartDate}`);
    
    await regenerateGroceryList(userId, weekStartDate);
    
    return NextResponse.json({ success: true });
  } catch (error: any) {
    console.error('Error regenerating grocery list:', error);
    return NextResponse.json(
      { error: error.message || 'Failed to regenerate grocery list' },
      { status: 500 }
    );
  }
}



